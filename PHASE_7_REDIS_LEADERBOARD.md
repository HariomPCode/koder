# Phase 7 - Redis Leaderboard Projection

**Status:** Architecture and reconnaissance only. No production code, schemas, routes,
services, workers, tests, Git index, history, branches, or remotes were changed by
this review.

**Baseline:** Phase 6 is checkpointed at `7b83371` and MongoDB is the authoritative
scoring system. This document supersedes the pre-Phase-6 Redis scoring assumptions in
`KODER_BACKEND_ROADMAP.md` wherever they conflict with the decisions below.

## Executive decision

Redis will be a rebuildable read-optimization projection of MongoDB
`ContestParticipant` aggregates. It will never calculate, approve, or persist an
authoritative score. The Phase 6 scoring service and reconciliation service remain the
only scoring decision paths.

The live projection will use one Redis sorted set per contest. The ZSET score will
contain only the exact solved-count bucket; the member will contain a fixed-width,
lexicographically sortable encoding of the remaining tie-break fields. This avoids
packing unbounded penalty/time/user identifiers into a Redis double and preserves the
canonical Phase 6 order exactly.

`FINALIZED` contests continue to read exclusively from the immutable
`ContestLeaderboardSnapshot`. Redis may retain or delete a finalized key, but it is
never needed for final correctness.

## 1. Current architecture

### Contest lifecycle

The implemented lifecycle is:

```text
DRAFT -> SCHEDULED -> REGISTRATION -> RUNNING -> ENDED -> FINALIZED
```

`backend/services/contest.service.js` performs server-time synchronization,
registration, contest submission intake, strict/forced finalization, final
reconciliation, and final snapshot creation. `Contest` is not updated on every
submission.

Contest submissions receive `submittedAtContestMs` at intake. Submissions are then
enqueued on the existing language-specific BullMQ queues.

### Authoritative scoring state

The Phase 6 state is:

| Collection | Role |
|---|---|
| `Submission` | Immutable judge-result history and rebuild input |
| `ContestScoredSubmission` | Per-submission scoring ledger and idempotency record |
| `ContestParticipantProblem` | Canonical first AC, solve time, and problem penalty |
| `ContestParticipant` | Authoritative participant aggregate used for live standings |
| `ContestLeaderboardSnapshot` | Durable immutable final standings |
| `ContestFinalizationAudit` | Force-finalization exclusions and audit evidence |

The canonical ordering is:

1. `solvedCount` descending
2. `totalPenalty` ascending
3. `lastAcceptedContestMs` ascending, with unsolved represented as infinity
4. `userId` ascending

The shared contract in `packages/shared/contracts/scoring.js` and the Mongo index on
`ContestParticipant` implement this ordering.

### Judge to scoring flow

```text
contest submission intake
  -> Submission.create
  -> BullMQ language queue
  -> workers/common/executionEngine.js
  -> packages/shared/db/dbCalls.js:updateSubmission
  -> packages/shared/scoring/applySubmissionResult.js
  -> ContestScoredSubmission / ContestParticipantProblem /
     ContestParticipant (Mongo authoritative state)
  -> Phase 7 projection producer (after authoritative scoring returns)
```

`updateSubmission` has a terminal-state guard. Duplicate completion handling invokes
scoring again safely. A scoring failure is logged and remains recoverable through
`backend/services/scoring-reconcile.service.js`.

### Existing Redis and queues

Redis is already used by:

- BullMQ queues in `backend/queue/queueAdapter.js`
- BullMQ workers in `workers/common/workerFactory.js`
- Host execution admission control in `workers/common/hostCapacity.js`

Redis configuration is centralized in `packages/shared/config/queues.js`. Redis is
available in `docker-compose.yml` with append-only persistence, but that persistence
does not change the projection's derived-state status.

There is no existing leaderboard Redis key, projection consumer, leaderboard-specific
queue, or Redis read path in the implemented standings API.

### Current standings endpoints

`GET /api/v1/contests/:contestId/standings`:

- `RUNNING` and `ENDED`: reads paginated, sorted `ContestParticipant` documents.
- `FINALIZED`: reads and slices the final `ContestLeaderboardSnapshot`.
- Computes competition ranks, including ranks spanning page boundaries.

`GET /api/v1/contests/:contestId/standings/me`:

- `RUNNING` and `ENDED`: reads the participant from Mongo and counts participants
  ahead using the full canonical tie-break predicate.
- `FINALIZED`: finds the user in the final snapshot.

Routes already exist in `backend/routes/contest.route.js`; Phase 7 should preserve
their paths and response shape.

## 2. Source-of-truth boundary

### MongoDB writes first

The existing Phase 6 path writes, in order determined by the scoring service:

1. The terminal judge result to `Submission`.
2. The idempotency/effect record to `ContestScoredSubmission`.
3. Per-problem canonical state to `ContestParticipantProblem`.
4. The recomputed aggregate (`solvedCount`, `totalPenalty`,
   `lastAcceptedContestMs`) to `ContestParticipant`.

The projection must only be scheduled after the Mongo scoring operation has returned.
The projection job is identifiers-only:

```json
{ "contestId": "...", "userId": "..." }
```

Its consumer must re-read the current `ContestParticipant` document. It must never
trust `solvedCount`, `totalPenalty`, `lastAcceptedContestMs`, rank, or any other
score state supplied by a queue payload.

The producer belongs at the process integration boundary after Phase 6 scoring, not
automatically inside `packages/shared/db/dbCalls.js`. Shared scoring must finish
authoritative Mongo writes first. Projection enqueue failure is logged and retried
without failing scoring or submission completion.

### Redis writes

Redis receives only a derived participant projection:

- one sorted-set membership for the participant's current aggregate sort position;
- one participant-to-member mapping for direct lookup and replacement;
- optional metadata for projection version, rebuild state, and timestamps.

Redis does not receive raw submission verdicts, wrong-attempt counters, canonical AC
decisions, or independent scoring state.

### Redis unavailable

Mongo scoring succeeds even if Redis, the projection queue, or a projection worker is
unavailable. The API falls back to Mongo for `RUNNING`/`ENDED` standings. This is a
performance degradation, not a scoring failure.

Projection enqueue failures must be observable and retryable, but must not be
converted into submission or scoring failures.

There is an intentional crash gap:

```text
Mongo scoring succeeds
  -> process crashes
  -> projection queue job is never created
```

Phase 7 therefore requires a startup and/or periodic projection sweep, plus an
operator/admin contest rebuild. A missing-key read may trigger a lazy rebuild.
No outbox is required by the current architecture; add one only if later
reliability requirements prove that sweep/rebuild recovery is insufficient.

### Rebuild and stale recovery

A rebuild deletes or replaces only the contest's derived Redis keys, then streams all
Mongo `ContestParticipant` rows for the contest and writes the current projection.
Rebuilds are idempotent and may run repeatedly.

Projection metadata does not represent an exact Mongo revision. It represents
operational projection state only:

- `ready` or `rebuilding`;
- current active projection generation;
- last successful participant refresh time;
- last rebuild ID;
- health/error state.

A read may use Redis only when the active generation is `ready`, the required key
exists, and the projection passes bounded health checks. Missing metadata, a missing
key, a failed health check, or an explicit stale/error state causes a Mongo fallback
and an asynchronous rebuild request.

The normal write path is eventually consistent. A Redis rank is never presented as
authoritative if the API detects a failed or incomplete projection state.

### Finalized contests

Finalization already:

1. drains or explicitly excludes pending submissions;
2. reconciles Mongo scoring;
3. writes `ContestLeaderboardSnapshot { isFinal: true }`;
4. transitions the contest to `FINALIZED`.

The final snapshot is the sole final-read source. A finalization hook may mark the
Redis projection immutable/retained or set a retention TTL, but it must not make
finalization depend on Redis availability. Late terminal results remain excluded by
Phase 6 rules and cannot alter the final snapshot or a live projection.

Redis must never influence authoritative scoring, finalization eligibility, snapshot
contents, or rating inputs.

Redis is not part of finalization correctness. The locked finalization sequence is:

```text
drain or force-exclude pending submissions
  -> reconcile Mongo scoring
  -> write immutable ContestLeaderboardSnapshot
  -> transition contest to FINALIZED
```

Redis availability must never block or fail this sequence. `FINALIZED` standings are
snapshot-only even when a Redis projection remains available.

## 3. Redis data model

### Keys

Use a versioned namespace to make migrations and safe deletion explicit:

```text
koder:v1:contest:{contestId}:leaderboard:{generation}
koder:v1:contest:{contestId}:leaderboard:{generation}:members
koder:v1:contest:{contestId}:leaderboard:{generation}:meta
koder:v1:contest:{contestId}:leaderboard:activeVersion
```

`{contestId}` is the Mongo ObjectId string. Every key is contest-scoped; no
participant can rank across contests.

| Key | Type | Purpose |
|---|---|---|
| `...:{generation}` | ZSET | Ordered members for `ZRANGE`, `ZRANK`, and counts |
| `...:{generation}:members` | HASH | `userId -> current encoded member` |
| `...:{generation}:meta` | HASH | state, generation, refresh/rebuild/error metadata |
| `...:activeVersion` | STRING | Atomic pointer to the active generation |

Do not use the old roadmap's per-user `:solved` SET or wrong-count strings. Those
would duplicate Phase 6 scoring state and create a second source of truth.

### Exact ordering encoding

Redis orders ZSET members lexicographically only when their numeric scores are equal.
Use:

```text
zsetScore = -solvedCount
member = <penalty>|<lastAccepted>|<userId>
```

The locked Phase 7 representation is:

```text
ZSET score: -solvedCount
member:     <penalty-uint32>|<last-accepted-uint64>|<userId-oid>
```

Encoding rules:

- `solvedCount`: integer in `[0, 2^31 - 1]`; negative or overflowing values are
  rejected.
- `totalPenalty`: non-negative integer in `[0, 2^32 - 1]`, encoded as exactly
  10 decimal digits, zero-padded.
- `lastAcceptedContestMs`: non-negative integer in `[0, 2^53 - 1]`, encoded as
  exactly 16 decimal digits, zero-padded.
- unsolved `lastAcceptedContestMs` is encoded as the 16-digit all-9 sentinel,
  representing positive infinity.
- `userId` is normalized to lowercase 24-character Mongo ObjectId hex. Non-ObjectId
  identifiers are rejected until a separate identifier contract exists.
- the delimiter is `|`; ObjectId hex contains no delimiter.
- malformed tokens, invalid widths, invalid digits, invalid sentinel placement, and
  overflow are hard decode errors. The read path must mark the projection unhealthy,
  fall back to Mongo, and request rebuild; it must not guess or silently repair data.

These bounds are validation limits for the projection encoding, not new scoring
semantics. If a contest can exceed them, Phase 7 must stop with an explicit error
rather than silently misorder participants.

The member has no ambiguous delimiter because ObjectIds contain only lowercase
hexadecimal characters. The ZSET is read ascending, so `-solvedCount` gives higher
solved counts first, and equal solved-count members compare by penalty, last accepted
time, then ObjectId. This is exactly the Phase 6 order without relying on floating
point precision.

The current application uses Mongo ObjectIds for `userId`; if another identifier
format is introduced, a canonical bytewise sortable encoding must be specified before
it can enter the member token. Redis byte ordering and the comparator contract must
not silently diverge.

### Update protocol

For a participant projection:

1. Read the current Mongo `ContestParticipant`.
2. Build the new member token.
3. Read the old token from the HASH.
4. Use a Lua script or transactional Redis operation to remove the old ZSET member
   when it differs, add the new member with `-solvedCount`, and update the HASH.
5. Record refresh time, generation, and health/error state in metadata. This is not
   an exact Mongo revision.

The operation is idempotent. Replaying an old job still reads the current Mongo
aggregate, so queue delivery order cannot regress the projection.

### Reads

- Page: `ZRANGE key offset end WITHSCORES`, then decode members and hydrate the
  participant fields from the member token.
- Total: `ZCARD key`.
- User rank: HASH lookup followed by `ZRANK`; convert zero-based rank to one-based
  competition rank as described below.
- Participant lookup: HASH lookup by `userId`, then decode the token.

Because the member token contains the complete deterministic key, no Mongo read is
needed for a healthy live top-page or `/standings/me` lookup. User display metadata
must not be added to the ordering token; if needed later, hydrate it separately.

### Rank semantics

Phase 7 preserves Phase 6's deterministic ordinal ranking: `1, 2, 3, ...`.
`userId` is the final ordering tiebreak and participant membership is unique per
`(contestId, userId)`, so Phase 7 must not introduce competition-rank gaps such as
`1, 2, 2, 4`.

The Redis rank is therefore `ZRANK + 1` after reading the participant's current
member token. The page rank is `offset + index + 1`, subject to the same complete
ordering. This is intentionally aligned with the current Mongo repository and
standings API behavior.

## 4. Consistency and failure modes

| Situation | Required behavior |
|---|---|
| Normal AC changes Mongo aggregate | Enqueue one projection refresh; Redis eventually reflects latest aggregate |
| Duplicate scoring event | Phase 6 ledger remains idempotent; projection job rereads current Mongo and is harmless |
| Out-of-order scoring jobs | Older job cannot overwrite newer score because it does not carry score state |
| Concurrent first AC | Phase 6 determines canonical state; projection only mirrors resulting aggregate |
| Mongo success, Redis failure | Keep Mongo result; log/metric projection failure; serve Mongo fallback; retry/rebuild |
| Redis success, process crash | Projection is still derived; replayed job is idempotent |
| Missing key or metadata | Treat as cache miss; serve Mongo and schedule rebuild |
| Redis restart/flush | Health/readiness detects it; rebuild contest projections from Mongo |
| Reconciliation repair | After Mongo repair, enqueue/rebuild the affected participant or contest |
| Finalization | Snapshot and status transition do not depend on Redis; final reads use snapshot |
| Finalized late result | Phase 6 rejects/excludes it; no projection mutation is authoritative |
| Corrupt member token | Mark projection unhealthy, do not guess; rebuild from Mongo |

Correctness guarantees are provided by Mongo, Phase 6 idempotency, reconciliation,
and the final snapshot. Redis availability, freshness, read latency, and rebuild
completion are performance/operational guarantees only.

### Ownership of operational guarantees

| Concern | Owner |
|---|---|
| Projection failure logging/metrics | Projection producer, worker, and read service |
| Rebuild concurrency control | Projection service; one active rebuild per contest/generation |
| Admin authorization/audit | Existing admin middleware and an admin rebuild operation requiring actor and reason |
| Mongo-success/queue-crash recovery | Startup/periodic projection sweep plus operator/admin rebuild |
| Redis timeout policy | Standings read service; bounded timeout followed by Mongo fallback |
| Stale/missing projection handling | Standings read service marks unhealthy, falls back, and requests rebuild |
| Active-version migration | Projection rebuild service and versioned key contract; pointer update is atomic |

## 5. Rebuild and reconciliation design

### Required operations

Phase 7 should add:

- participant projection refresh;
- contest projection rebuild;
- projection health/metadata inspection;
- Redis-vs-Mongo sampled or full consistency check;
- admin-triggered rebuild endpoint or command;
- automatic lazy rebuild on missing/stale keys.

The contest rebuild must reuse the Phase 6 `ContestParticipant` aggregates and must
not rescore `Submission` documents. If Mongo aggregates themselves are suspect,
invoke the existing Phase 6 scoring reconciliation first, then rebuild Redis.

### Recommended rebuild algorithm

```text
1. Confirm contest exists and read its status.
2. Mark projection meta state = rebuilding and assign a rebuildId.
3. Write a temporary versioned ZSET/HASH pair.
4. Stream ContestParticipant rows sorted by userId.
5. Encode and insert every current aggregate.
6. Set metadata count, rebuild ID, and state = ready.
7. Atomically update the single `activeVersion` pointer with a Lua script.
8. Delete the previous version after the swap.
```

Versioned namespaces plus one atomic active-version pointer are the required rebuild
strategy. Do not model renaming multiple independent Redis keys as one atomic
operation. Readers resolve the active generation once, then read only that
generation. A rebuild may be run for `RUNNING`, `ENDED`, or operationally for
`FINALIZED`, but finalized API reads remain snapshot-only.

### Projection triggers

Normal refresh is required when the authoritative participant aggregate may change:

- first solve;
- canonical AC correction;
- aggregate repair.

A wrong attempt after the participant has already solved the problem does not change
`ContestParticipant` and does not require a score-state refresh. Reconciliation must
explicitly refresh repaired participants or rebuild the affected contest after Mongo
state is repaired.

### Drift check

For a healthy projection, compare a bounded sample or full contest export against
Mongo sorted by the same key. Detect:

- missing participant;
- extra participant;
- wrong member encoding/score;
- wrong count;
- metadata source version mismatch.

Drift repair is projection-only. It must not update Mongo scoring fields.

## 6. API impact

No route changes are proposed in this reconnaissance.

| Contest status | Primary standings source | Fallback |
|---|---|---|
| `RUNNING` | Redis projection when ready | Mongo `ContestParticipant` query |
| `ENDED` | Redis projection when ready | Mongo `ContestParticipant` query |
| `FINALIZED` | `ContestLeaderboardSnapshot` exclusively | Redis is never consulted |

The existing routes and response shape remain:

```text
GET /api/v1/contests/:contestId/standings
GET /api/v1/contests/:contestId/standings/me
```

Pagination remains bounded by the current `limit <= 100` rule. Redis provides global
ordering and `ZCARD`; it must not turn `/standings/me` into a page-local rank.

The healthy Redis path must return the same rank semantics as the current Mongo path,
including competition ranks. A Redis timeout should use a short bounded timeout and
fall back to Mongo rather than delaying the request indefinitely.

The old roadmap's proposed `/leaderboard` route is not adopted; the implemented
`/standings` routes are the compatibility surface.

## 7. Performance analysis

Assuming one Mongo aggregate update per solved problem and no aggregate update for a
wrong attempt:

- Projection enqueue: one lightweight job per scoring invocation, or coalesced by
  `(contestId, userId)` during bursts.
- Redis write: one HASH read, one ZSET removal/addition, one HASH write; a Lua script
  can make this one round trip.
- Live page read: `ZRANGE` plus `ZCARD`, approximately O(log N + page size).
- Rank lookup: `HGET` plus `ZRANK`, O(log N), plus tie-group handling.
- Pagination: O(log N + page size), independent of Mongo sort cost.
- Participant rebuild: O(P log P) logical work and O(P) Redis members, where P is
  registered participants.
- Full contest rebuild input: streams P aggregate documents, not all submissions.

For 10,000 participants and one member plus one hash entry per participant, memory is
linear in participant count. The main scale risks are:

- retaining duplicate historical member tokens after updates;
- building a full temporary board without a memory budget;
- using one giant multi-contest key;
- storing full JSON participant documents in each ZSET member;
- unbounded TTL/retention for ended contests;
- attempting to encode all tie-break fields into an imprecise Redis double.

The update script must remove old members, rebuilds must use bounded batches, and
retention must be explicit. TTL is an operational policy, not a correctness mechanism.

## 8. Proposed implementation file list

This list is intentionally proposed only; none of these files were created or
modified in Phase 7 reconnaissance.

### Create

- `packages/shared/leaderboard/leaderboardEncoding.js` - canonical member-token
  encoding/decoding and overflow validation.
- `packages/shared/config/leaderboard.js` - key namespace, queue/job names, widths,
  rebuild state, retention, and timeout constants.
- `backend/repositories/leaderboard.repository.js` - Mongo aggregate cursors and
  projection metadata access boundaries.
- `backend/services/leaderboard-projection.service.js` - refresh, rebuild, health,
  drift check, and fallback policy.
- `backend/queue/leaderboardQueue.js` - dedicated BullMQ producer/connection
  adapter, reusing the existing Redis configuration.
- `backend/jobs/leaderboardProjectionSweep.js` - startup/periodic recovery for the
  Mongo-success/queue-crash gap and missing participant refreshes.
- `workers/leaderboard/worker.js` - projection consumer that reads current Mongo
  aggregates and applies the idempotent Redis update.
- `backend/routes/admin-leaderboard.route.js` or an equivalent extension to
  `backend/routes/admin.route.js` - admin rebuild/health operations, if the existing
  admin surface is retained.

### Modify

- selected Phase 6 scoring integration boundary - publish an identifier-only
  projection job only after successful contest scoring, with projection failures
  isolated from submission completion. Do not automatically place backend leaderboard
  queue logic in `packages/shared/db/dbCalls.js`.
- `packages/shared/index.js` - export leaderboard contracts/configuration.
- `backend/services/contest.service.js` - select Redis for healthy `RUNNING`/`ENDED`
  reads and retain snapshot-only `FINALIZED` behavior.
- `backend/routes/admin.route.js` - mount rebuild/health operations if not split.
- `backend/repositories/contest.repository.js` - add any bounded aggregate cursor or
  projection source helpers needed by the service.
- `docker-compose.yml` - only if a separate leaderboard worker process is added to
  the local development topology.
- `KODER_BACKEND_ROADMAP.md` - mark the old Redis-authoritative scoring text as
  superseded and link this Phase 7 decision.

### Tests to create or modify

- `backend/test_leaderboard_encoding.js`
- `backend/test_leaderboard_projection.js`
- `backend/test_leaderboard_rebuild.js`
- `backend/test_leaderboard_failure_modes.js`
- `backend/test_standings_api.js` - Redis path, Mongo fallback, competition ranks,
  and finalized snapshot behavior.
- `backend/test_contest_finalization.js` - Redis unavailable during finalization and
  finalized reads bypassing Redis.
- `backend/test_scoring_ordering.js` - projection equality after all arrival-order
  permutations, without moving scoring authority to Redis.

### Documentation to update

- `PHASE_7_REDIS_LEADERBOARD.md` - implementation decisions and operational runbook.
- `KODER_BACKEND_ROADMAP.md` - corrected source-of-truth boundary and issue status.
- `ISSUES.md` - add or update Phase 7 issue definitions after issue ownership is
  confirmed; do not duplicate the obsolete roadmap scoring consumer.

## 9. Issue breakdown and implementation order

`ISSUES.md` contains no `ISSUE-701`-style Phase 7 section. The roadmap contains
legacy future issues `ISSUE-119`, `ISSUE-120`, `ISSUE-121`, and `ISSUE-126`, but
their assumptions predate the Phase 6 Mongo authority decision:

- `ISSUE-119` must be re-scoped from Redis scoring consumer to Mongo-to-Redis
  projection worker.
- `ISSUE-120` maps to the existing `/standings` endpoints, not new `/leaderboard`
  routes.
- `ISSUE-121` must not replace the already-implemented Phase 6 final snapshot; it
  should cover projection rebuild/retention and operational recovery.
- `ISSUE-126` is a product decision about pre-seeding, not an implementation
  prerequisite. The recommended default is to project every registered participant
  at contest start, because it gives a complete zero-score board; it must still be
  confirmed before implementation.

The following numbering is therefore **proposed for catalog update only**, not an
assertion that these issues already exist:

| Order | Proposed issue | Purpose | Dependencies | Acceptance criteria | Complexity / risk |
|---|---|---|---|---|---|
| 1 | `ISSUE-701` | Lock encoding, key schema, projection contract | Phase 6 complete | Exact ordering fixtures, overflow/null policy, key/version contract documented | M / high correctness risk |
| 2 | `ISSUE-702` | Add identifier-only projection delivery and idempotent participant refresh | 701 | Mongo success may enqueue `{contestId,userId}`; consumer rereads Mongo; duplicate/out-of-order jobs converge; Redis errors do not fail scoring; crash-gap sweep ownership is defined | M / failure-isolation risk |
| 3 | `ISSUE-703` | Build contest rebuild, active-version publication, health, drift, and recovery | 701, 702 | Versioned temporary generation, atomic activeVersion pointer, readiness/error states, missing/corrupt recovery, admin authorization/audit, rebuild concurrency control | M / operational risk |
| 4 | `ISSUE-704` | Route live standings through Redis with Mongo fallback | 701-703 | Running/ended pages and `/me` match Mongo ordinal ranks; bounded timeout/fallback; finalized never consults Redis | M / rank semantics risk |
| 5 | `ISSUE-705` | Optional pre-seeding and Redis retention policy | 703, 704 | Only approved pre-seeding, ended retention, and optional finalized-key cleanup; no change to finalization correctness | S/M / unresolved product policy |
| 6 | `ISSUE-706` | Full correctness, failure, recovery, and scale validation | 701-705 | Ordering equivalence, crash-gap recovery, Redis restart/flush, fallback, finalized isolation, 10k-participant benchmark | L / environment-dependent |

Do not begin `ISSUE-702` until the Phase 7 encoding contract is locked. Do not
replace the current Mongo read path in `ISSUE-704` until fallback and ordinal-rank
tests pass. Do not make finalization depend on any Phase 7 issue.

### Provisional issue ownership

These issue numbers are not present in `ISSUES.md`; this is an implementation
planning breakdown only.

| Issue | Required ownership |
|---|---|
| `ISSUE-701` | Encoding contract, exact Phase 6 ordering equivalence, key namespace, fixed widths/bounds, malformed-token policy, metadata states, active-version pointer contract, and pure tests |
| `ISSUE-702` | Identifier-only `{contestId,userId}` producer/queue, Mongo reread, atomic participant refresh, duplicate/out-of-order convergence, trigger filtering, failure isolation, retry/coalescing, and projection failure metrics |
| `ISSUE-703` | Versioned-generation rebuild, atomic `activeVersion`, readiness/error state, rebuild concurrency control, drift checks, startup/periodic sweep, lazy recovery, admin authorization/audit, and Redis restart/flush recovery |
| `ISSUE-704` | Existing standings endpoints, healthy Redis reads for `RUNNING`/`ENDED`, bounded timeout, Mongo fallback, ordinal rank correctness, and strict snapshot-only `FINALIZED` reads |
| `ISSUE-705` | Only approved optional pre-seeding, ended-contest retention, and optional finalized-key cleanup. If product decisions remain unresolved, this issue stays deferred and does not alter finalization |
| `ISSUE-706` | Cross-issue correctness, failure, recovery, concurrency, fallback, finalization isolation, and scale validation |

## 10. Unresolved decisions

1. **Issue catalog ownership:** `ISSUE-701` through `ISSUE-706` remain provisional;
   neither `ISSUES.md` nor the roadmap currently defines them as existing issues.
2. **Projection delivery topology:** asynchronous delivery is the locked default
   because it isolates judge/scoring latency and supports retry/rebuild. The exact
   BullMQ worker placement remains a deployment decision.
3. **Participant pre-seeding:** unresolved product decision; do not implement until
   approved.
4. **Retention:** unresolved product/deployment decision for ENDED contests and
   optional finalized-key cleanup; do not invent TTL behavior.
5. **Projection freshness policy:** immediate Mongo fallback on missing, rebuilding,
   stale, unhealthy, or malformed projection is the locked safe default.
6. **Identifier contract:** current ObjectId user IDs are locked for this phase.
   Future identifier formats require a new encoding contract.
7. **Operational endpoint shape:** separate admin leaderboard route versus extension
   of `backend/routes/admin.route.js`.

## 11. Validation record

- **Git status:** inspected read-only at review start; no Git write command was run.
- **HEAD:** `7b833716803dc62484cad712d84fcc1d5288ea8a`
- **HEAD subject:** `7b83371 feat: complete Phase 6 scoring reconciliation and finalization`
- **Implementation started:** no.
- **Files changed by this review:** `PHASE_7_REDIS_LEADERBOARD.md` and
  `KODER_BACKEND_ROADMAP.md` only, as documentation artifacts.
- **Git staging/history/remote:** not modified.

### Exact files inspected

- `ISSUES.md`
- `KODER_BACKEND_ROADMAP.md`
- `PHASE_6_SCORING_ENGINE.md`
- `docker-compose.yml`
- `package.json`
- `backend/package.json`
- `workers/package.json`
- `packages/shared/package.json`
- `packages/shared/config/queues.js`
- `packages/shared/contracts/scoring.js`
- `packages/shared/db/dbCalls.js`
- `packages/shared/index.js`
- `packages/shared/models/ContestParticipant.js`
- `packages/shared/models/ContestParticipantProblem.js`
- `packages/shared/models/ContestScoredSubmission.js`
- `packages/shared/models/ContestLeaderboardSnapshot.js`
- `backend/models/ContestParticipant.js`
- `backend/models/ContestParticipantProblem.js`
- `backend/models/ContestScoredSubmission.js`
- `backend/models/ContestLeaderboardSnapshot.js`
- `backend/repositories/contest.repository.js`
- `backend/repositories/scoring.repository.js`
- `backend/services/contest.service.js`
- `backend/services/scoring-reconcile.service.js`
- `backend/routes/contest.route.js`
- `backend/routes/admin.route.js`
- `backend/queue.js`
- `backend/queue/queueAdapter.js`
- `backend/test_standings_api.js`
- `backend/test_contest_finalization.js`
- `backend/test_scoring_ordering.js`
- `backend/test_scoring_reconciliation.js`
- `workers/common/executionEngine.js`
- `workers/common/workerFactory.js`
- `workers/common/hostCapacity.js`

## Recommended next sequence

First resolve the issue-catalog and topology decisions, then implement `ISSUE-701`
through `ISSUE-703` as projection infrastructure and recovery. Validate exact rank
equivalence against Mongo before changing either standings endpoint. Integrate
`RUNNING`/`ENDED` Redis reads only after fallback and failure tests pass, and keep
`FINALIZED` snapshot-only throughout.
