# Phase 6 — Scoring Engine Architecture Review

Status: architecture review only. No implementation code was changed.

## Scope and guardrails

This review designs the authoritative MongoDB-based contest scoring system and the implementation/dependency plan for Phase 6.

Out of scope for this phase:
- Redis leaderboard projection (Phase 7)
- Redis Streams / SSE delivery (Phase 8)
- Frontend contest UX changes
- Rating calculation (later phase)
- 10k-user load testing
- Judge worker redesign

In scope:
- Scoring semantics and contract
- Authoritative MongoDB scoring state
- Judge-result integration boundary
- Idempotency, ordering, concurrency, recovery
- Finalization interaction and snapshot contract
- Mongo standings API (conceptual; no Redis dependency)
- Issue breakdown and dependency graph

## Primary architectural principle

```text
Judge
  ↓
Submission Result (MongoDB)
  ↓
Scoring Engine
  ↓
MongoDB AUTHORITATIVE contest score/state
  ↓
Redis leaderboard projection       [Phase 7]
  ↓
SSE                              [Phase 8]
  ↓
Frontend
```

MongoDB remains the permanent source of truth for contest standings. Redis must be rebuildable from MongoDB authoritative data. If Redis is deleted, standings can be reconstructed from `Submission` history plus authoritative scoring projections.

---

## 1. Current model audit (code-verified)

### What exists today

| Area | Current state | Scoring readiness |
|------|---------------|-------------------|
| `Contest` | Full lifecycle (`DRAFT` → `FINALIZED`), embedded `problems[]` with `points`, `penaltyMinutes`, `order` | Ready — contest metadata is authoritative |
| `ContestParticipant` | `contestId`, `userId`, `registeredAt` only | **No scoring fields** — must be extended or supplemented |
| `ContestLeaderboardSnapshot` | `standings[]` with `rank`, `solvedCount`, `score`, `penalty`, `lastAcceptedAt` | Schema exists; **not written by any code path** |
| `Submission` | `contestId`, `contestProblemId`, `submittedAtContestMs`, `status`, `verdict` | Ready — immutable event history |
| `contest.service.js` | Lifecycle, registration, submission intake, `submittedAtContestMs` at creation, `finalizeContest()` sets `FINALIZED` | Intake timing is correct; **no scoring** |
| `updateSubmission` (`dbCalls.js`) | Terminal guard: refuses overwrite when `status === completed` | Idempotent at submission-result level |
| Workers (`executionEngine.js`) | Persist verdict via `updateSubmission`; no contest logic | Correct judge boundary |
| `submissionEventPublisher` / `eventBus` | In-process event bus exists | **Never wired** — no `submission.completed` emission |
| Standings API | Not implemented | Phase 6 conceptual API only |
| Scoring consumer/service | Does not exist | Greenfield |

### Phase 5 implementation gaps relevant to scoring

1. `finalizeContest()` transitions status to `FINALIZED` but does **not** create a `ContestLeaderboardSnapshot`.
2. No guard prevents scoring mutations after finalization (scoring does not exist yet).
3. No reconciliation path for completed contest submissions that were never scored.
4. `Contest.problems[].points` and `penaltyMinutes` exist but no code interprets them.
5. Event infrastructure is scaffolded but unused; scoring trigger must be designed deliberately.

### Indexes already present (scoring-relevant)

From `Submission`:
- `{ contestId: 1, userId: 1, contestProblemId: 1, verdict: 1 }`
- `{ contestId: 1, status: 1 }`
- `{ status: 1, createdAt: 1 }`

From `ContestParticipant`:
- `{ contestId: 1, userId: 1 }` unique
- `{ userId: 1 }`

From `ContestLeaderboardSnapshot`:
- `{ contestId: 1, isFinal: 1 }`
- `{ contestId: 1, takenAt: -1 }`

These support reconciliation queries but are insufficient alone for idempotent scoring ledger lookups.

---

## 2. Scoring model decision

### Chosen model: ACM/ICPC-style penalty scoring

Koder will use **ACM/ICPC-style scoring**, not points-based LeetCode-contest scoring.

**Rationale (grounded in the repo, not assumption):**
- `Contest.problems[].penaltyMinutes` is modeled per problem — an ICPC hallmark.
- `ContestLeaderboardSnapshot.standings[]` stores `solvedCount` and `penalty`, not summed points.
- Phase 5 architecture explicitly separated judge verdict from contest ranking and described penalty-based ranking.
- `Contest.problems[].points` remains in schema for future product use (display, difficulty weighting, or a later points-based mode) but **does not affect Phase 6 ranking**.

### Formal definitions

| Term | Definition |
|------|------------|
| **Solved problem** | A contest problem for which the participant has at least one terminal `Accepted` submission admitted during the contest window |
| **Solved count** | Number of distinct contest problems solved |
| **Problem solve time** | `submittedAtContestMs` of the **first** `Accepted` submission for that problem (milliseconds from contest start) |
| **Wrong attempt** | A terminal non-`Accepted` submission for a problem that is not yet solved |
| **Problem penalty** | `floor(solveTimeMs / 60000) + wrongAttemptsBeforeSolve × penaltyMinutes` |
| **Total penalty** | Sum of problem penalties over all solved problems |
| **Rank score** | Derived sort key: higher solved count wins; lower total penalty wins |

**No partial scoring.** A problem is either solved (`Accepted`) or not. There is no fractional credit.

### What constitutes a solved contest problem?

A problem is solved **if and only if** the participant has a terminal judge verdict of:

```text
Accepted
```

All other terminal verdicts do not solve the problem. Non-terminal submission statuses (`created`, `queued`, `running`, legacy `pending`) do not affect scoring until `completed`.

---

## 3. Multiple submissions semantics

For submissions to the same contest problem by the same participant:

| Submission sequence | Scoring effect |
|---------------------|----------------|
| WA → WA → AC → AC | First AC counts; both WAs count toward penalty; second AC ignored |
| AC → WA | First AC counts; later WA ignored (problem already solved) |
| WA → AC → WA | Same as first row |
| CE → RE → TLE → AC | CE, RE, TLE each count as one wrong attempt before solve |
| Multiple AC with same `submittedAtContestMs` | Earliest by `(submittedAtContestMs, submissionId)` lexicographic wins |

### Rules (exact)

1. **Canonical solve submission** = minimum `(submittedAtContestMs, submissionId)` among all terminal `Accepted` submissions for `(contestId, userId, contestProblemId)`.
2. **Submissions after first solve** are recorded in `Submission` history but **ignored for scoring** (no penalty change, no time change).
3. **Wrong attempts** count only if:
   - verdict is in the wrong-attempt set (see §6),
   - submission is terminal (`status === completed`),
   - `submittedAtContestMs` is strictly less than canonical solve time, and
   - problem was not already solved at processing time.
4. **Wrong count for penalty** is computed at solve time by querying authoritative `Submission` records, not by relying on arrival order.

This makes multiple-submission behavior deterministic regardless of worker completion order.

---

## 4. Penalty model

### Formula

For each solved problem `p`:

```text
solveMinutes_p = floor(firstAcceptedSubmittedAtContestMs_p / 60000)

wrongAttempts_p = count of terminal submissions for problem p where:
  - verdict ∈ WRONG_ATTEMPT_VERDICTS
  - submittedAtContestMs < firstAcceptedSubmittedAtContestMs_p

problemPenalty_p = solveMinutes_p + wrongAttempts_p × contest.problems[p].penaltyMinutes

totalPenalty = Σ problemPenalty_p over all solved problems
```

### Examples

Contest problem `penaltyMinutes = 5`.

| Events | Penalty for that problem |
|--------|--------------------------|
| AC at 37:00 (2220000 ms) | 37 + 0×5 = **37** |
| WA, WA, AC at 40:00 | 40 + 2×5 = **50** |
| CE at 10:00, AC at 15:00 | 15 + 1×5 = **20** |

### Points field

`Contest.problems[].points` is **not used** in Phase 6 ranking. Snapshot `score` field stores **solved count** (see §17) for compatibility with existing snapshot schema; `penalty` stores total penalty minutes.

---

## 5. Tie-breaking rules

Deterministic ranking order (best rank first):

1. **Solved count** descending (more problems solved ranks higher)
2. **Total penalty** ascending (lower penalty ranks higher)
3. **Last accepted time** ascending — `max(firstAcceptedSubmittedAtContestMs)` across solved problems; earlier is better
4. **User ID** ascending — stable deterministic tiebreak

`lastAcceptedAt` in `ContestLeaderboardSnapshot` stores absolute wall time:

```text
contest.startTime + lastAcceptedContestMs
```

### Rank assignment

After sorting, assign `rank` sequentially (1..N). True ties (identical on all four keys) receive the same rank number; next rank skips accordingly (competition ranking / "1224" style) OR dense ranking — **recommend competition ranking** (standard ICPC display).

---

## 6. Submission timing rules

### Authoritative timestamp

**`submittedAtContestMs` at submission creation** is the only timestamp used for:
- solve time
- wrong-attempt ordering
- eligibility relative to contest window

**Never used for scoring:**
- worker completion time
- `updatedAt` on submission
- client-provided timestamps
- queue job timestamps

### Scenario matrix

| Scenario | Scoring behavior |
|----------|------------------|
| Submission created before `endTime`, worker executes after `endTime` | **Counts** — admission during `RUNNING` is authoritative |
| Accepted result processed after `endTime` | **Counts** — uses `submittedAtContestMs` from intake |
| Submission created after `endTime` | **Rejected at API** — never enters scoring |
| Submission still `queued`/`running` at finalization | Does not affect standings until terminal; finalization may block on drain policy |
| Worker replay of same result | Idempotent — no score change |
| Queue delay | **No ranking impact** — penalty uses intake time, not judge time |

### Eligibility predicate

A submission is scoring-eligible if:

```text
contestId != null
AND contestProblemId != null
AND submittedAtContestMs != null
AND status === completed
AND submission was created while contest.status === RUNNING
```

The last condition is guaranteed by current `createContestSubmission()` and should be treated as an invariant, not re-derived from worker time.

---

## 7. Judge verdict → scoring mapping

| Verdict | Terminal? | Solves problem? | Wrong attempt? (if unsolved) | Scoring action |
|---------|-----------|-----------------|------------------------------|----------------|
| `Accepted` | Yes | Yes (if canonical first AC) | No | Evaluate solve; recompute problem penalty |
| `Wrong Answer` | Yes | No | Yes | Ledger only until solve; included in wrong count at solve |
| `Compilation Error` | Yes | No | Yes | Same as WA |
| `Runtime Error` | Yes | No | Yes | Same as WA |
| `Time Limit Exceeded` | Yes | No | Yes | Same as WA |
| `Memory Limit Exceeded` | Yes | No | Yes | Same as WA |
| `created` / `queued` / `running` / `pending` | No | No | No | No scoring |
| Unknown future verdict | Yes (if worker sets completed) | No | **No** — log metric/alert | Do not penalize until contract extended |

### Constants

```text
WRONG_ATTEMPT_VERDICTS = {
  Wrong Answer,
  Compilation Error,
  Runtime Error,
  Time Limit Exceeded,
  Memory Limit Exceeded
}

SOLVING_VERDICT = Accepted
```

Do not change the existing `JUDGE_VERDICTS` contract. Scoring interprets it; the judge does not know about contests.

---

## 8. Idempotency strategy

### Problem

Worker architecture is at-least-once. The same terminal submission result may be processed multiple times. Scoring must be a pure function of authoritative state + submission ID.

### Chosen mechanism: scored-submission ledger + conditional state updates

**Layer 1 — `ContestScoredSubmission` ledger (new collection)**

```text
{
  submissionId,      // unique index
  contestId,
  userId,
  contestProblemId,
  verdict,
  submittedAtContestMs,
  scoredAt,
  effect: "none" | "wrong" | "solve" | "ignored-post-solve" | "ignored-noncanonical-ac"
}
```

- Insert with unique `{ submissionId: 1 }` as the idempotency gate.
- Duplicate insert means the submission event was seen before; scoring state must still be reconciled before returning.

**Layer 2 — conditional updates on `ContestParticipantProblem`**

- Solve transition uses `findOneAndUpdate({ solved: false, ... })`.
- If already solved, skip mutation (ledger still records `ignored-post-solve`).

**Layer 3 — submission terminal guard (existing)**

- `updateSubmission` already refuses to overwrite `completed` submissions.
- This protects judge results; scoring has its own ledger.

### Tradeoffs considered

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| Submission ID ledger | Simple, audit trail, replay-safe | Extra collection | **Adopt** |
| Flag on `Submission` (`scoredAt`) | No new collection | Mixes judge history with scoring; harder audit | Reject as primary |
| Mongo transaction (ledger + participant) | Strong atomicity | Contention, ops cost at 10k scale | **Not required** |
| Event ID / Redis dedup | Fast | Violates Mongo-authoritative principle for Phase 6 | Defer to Phase 7 fan-out only |

**Conclusion:** unique ledger insert + single-document conditional updates are sufficient. No multi-document transactions required for correctness.

---

## 9. Out-of-order result handling

### Requirement

Final score must not depend on event arrival order.

### Strategy

1. **Wrong-only submissions:** ledger insert only; no aggregate mutation (wrong count derived at solve time from `Submission` query).
2. **Accepted submissions:**
   - Compute canonical first AC from all **completed** `Accepted` submissions for `(contestId, userId, contestProblemId)`.
   - If current submission is not canonical → ledger `ignored-noncanonical-ac`, no solve.
   - If canonical and problem not solved → solve + compute `wrongAttempts` via submission query filtered by `submittedAtContestMs < canonicalAcMs`.
3. **Late WA before canonical AC time but arriving after solve processed:** ledger `ignored-post-solve`; wrong count was fixed at solve time from DB query, so penalty remains correct.

### Determinism proof sketch

Canonical solve is a function of the full submission set, not processing order. Wrong count at solve is computed from the same set. Ledger prevents double application of the same submission event.

---

## 10. Participant scoring state

### `ContestParticipant` (aggregate — authoritative summary)

Add fields:

```text
solvedCount: Number, default 0
totalPenalty: Number, default 0        // minutes
lastAcceptedContestMs: Number|null     // max first-solve time across problems
scoringVersion: Number, default 0      // optional, incremented on reconcile
```

**Purpose:** fast standings reads and snapshot generation. **Not** a substitute for per-problem state or submission history.

Do **not** add per-problem embedded arrays to `ContestParticipant` — document growth and array rewrite contention under concurrent per-problem updates.

### Separate `ContestParticipantProblem` (per-problem authoritative state)

```text
{
  contestId,
  userId,
  contestProblemId,
  solved: Boolean,
  firstAcceptedSubmissionId: ObjectId|null,
  firstAcceptedAtContestMs: Number|null,
  problemPenalty: Number,              // minutes; 0 if unsolved
  scoringUpdatedAt: Date
}
```

Unique index: `{ contestId: 1, userId: 1, contestProblemId: 1 }`.

**Why separate collection vs embedded vs derive-only:**

| Option | Correctness | Write contention | Rebuild | 10k scale | Decision |
|--------|-------------|------------------|---------|-----------|----------|
| Embedded in participant | Good | High — same doc per user | Medium | Risky under burst | Reject |
| Separate per-problem doc | Good | Low — one doc per user×problem | Easy | Good | **Adopt** |
| Derive only from Submission | Perfect audit | None on write | Expensive reads | Poor for live standings API | Reject for hot path; use for rebuild |

---

## 11. Submission as authoritative history

`Submission` remains the immutable event log. Scoring projections must be explainable from submissions.

### Required submission fields for scoring audit

| Field | Purpose |
|-------|---------|
| `_id` | Idempotency key |
| `userId` | Participant |
| `contestId` | Contest scope |
| `contestProblemId` | Problem scope |
| `submittedAtContestMs` | Authoritative time |
| `status` | Must be `completed` for scoring |
| `verdict` | Solve / wrong classification |
| `createdAt` | Tie-break secondary; audit only |

No duplication of full submission body in scoring collections. Ledger stores `submissionId` reference only.

### "Why does this participant have this score?"

Answer path:

1. Read `ContestParticipant` aggregate.
2. Read `ContestParticipantProblem` rows.
3. For any problem, trace `firstAcceptedSubmissionId` and query wrong submissions before that time.

---

## 12. Scoring event architecture

### Trigger point

```text
Worker executionEngine
  → updateSubmission (terminal write succeeds)
  → scoringService.applySubmissionResult(submissionId)   [NEW]
  → MongoDB authoritative updates
  → (Phase 7) enqueue Redis projection update
```

### Integration choice

**Invoke scoring synchronously from the shared post-result path** after a successful terminal `updateSubmission`, when `contestId` is set.

**Why:**
- Workers already call `@koder/shared` `updateSubmission` — single integration point.
- No new queue infrastructure required for Phase 6 correctness.
- Scoring is lightweight (few Mongo ops) compared to Docker judge.
- Failure can be retried via reconciliation sweep without Redis Streams.

**Also wire `submissionEventPublisher.emit('submission.completed', ...)` in the API process** is not possible from workers today. For Phase 6, scoring does not depend on the in-process event bus. Phase 7 may add emission after scoring for SSE fan-out.

### Retry and failure

| Failure | Behavior |
|---------|----------|
| Scoring throws after submission completed | Log error; submission remains completed; reconciliation sweep rescues |
| Duplicate scoring invocation | Ledger unique key → no-op |
| Scoring lag | Allowed — standings eventually consistent; uses intake timestamps so order of lag does not change ranks |

### Async option (future)

If scoring latency becomes measurable, add `scoring-queue` BullMQ job **after** Mongo terminal write. Phase 6 should implement the service first; queue decoupling is an optimization, not a correctness prerequisite.

---

## 13. Mongo transaction requirement

### Decision: no multi-document transactions for steady-state scoring

Use:
1. Unique ledger insert (fails on duplicate)
2. Conditional `findOneAndUpdate` on `ContestParticipantProblem`
3. Atomic `$inc` / `$set` on `ContestParticipant` aggregate

### When a transaction could be considered

- Finalization snapshot + status flip + scoring freeze in one atomic step — **optional** for finalization only, not per-submission.

### Rationale

- 10k participants × concurrent submissions → transaction contention on participant aggregates.
- Idempotency via unique index gives correctness without cross-document atomicity.
- Reconciliation fixes drift if a rare partial failure occurs.

---

## 14. Concurrent scoring strategy

### Same participant, different problems

Independent `ContestParticipantProblem` documents → no lost updates.

### Same participant, same problem, concurrent results

| Case | Handling |
|------|----------|
| WA + WA concurrent | Both ledger inserts; only first insert wins per submissionId; no aggregate change until solve |
| WA + AC concurrent | Solve path queries all submissions — correct wrong count after both persisted |
| AC + AC concurrent | Canonical AC selection by `(submittedAtContestMs, submissionId)`; conditional `solved: false` ensures one solve transition |

### Aggregate update

Use atomic operators on `ContestParticipant`:

```text
$inc: { solvedCount: 1, totalPenalty: delta }
$max or conditional set for lastAcceptedContestMs
```

Recompute `totalPenalty` from sum of `ContestParticipantProblem.problemPenalty` on solve to avoid incremental drift (preferred over blind `$inc` for penalty).

---

## 15. Rebuild / reconciliation strategy

### Full rebuild procedure

```text
For contest C:
  1. Load all scoring-eligible submissions (contestId=C, status=completed)
  2. Group by (userId, contestProblemId)
  3. For each group, determine canonical AC and wrong count (§3, §4)
  4. Upsert ContestParticipantProblem rows
  5. Recompute ContestParticipant aggregates
  6. Sort standings (§5)
  7. Optionally write ContestLeaderboardSnapshot
```

### Complexity

- O(S) submissions read + O(P) per-problem writes where S = submissions, P = participant×problem pairs with activity.
- For 10k users × 5 problems × ~10 submissions = ~500k submissions worst case — acceptable as admin/offline operation, not per-request.

### When used

- Post-incident recovery
- Pre-finalization audit (`recomputed === authoritative` assertion)
- Phase 7 Redis rebuild input
- Scheduled drift check (optional cron)

### Scoring state classification

| Store | Role |
|-------|------|
| `Submission` | Immutable event log (source) |
| `ContestScoredSubmission` | Processed-event ledger (idempotency) |
| `ContestParticipantProblem` | Authoritative per-problem projection |
| `ContestParticipant` | Authoritative aggregate projection |
| `ContestLeaderboardSnapshot` | Durable checkpoint / final record |

Projections are **authoritative for serving standings** but **rebuildable** from submissions.

---

## 16. Contest finalization interaction

### When scoring stops mutating

| Contest status | New scoring mutations |
|----------------|----------------------|
| `RUNNING` | Allowed |
| `ENDED` | Allowed for submissions admitted during `RUNNING` |
| `FINALIZED` | **Blocked** — all scoring writes rejected |

### Finalization prerequisites

Before `RUNNING → ENDED → FINALIZED`:

1. Contest window closed (`endTime` passed).
2. **Scoring drain policy (strict by default):** all submissions admitted during `RUNNING` must reach terminal state before finalize proceeds:
   - `count({ contestId, status: { $in: [created, queued, running] } }) === 0`
   - If non-zero, finalize is rejected unless admin passes `force: true` (see below).
3. Run reconciliation to ensure projections match submission replay.
4. Write `ContestLeaderboardSnapshot { isFinal: true }`.
5. Set `Contest.status = FINALIZED`.

### Force-finalize policy (locked)

| Rule | Behavior |
|------|----------|
| Default | **Strict drain** — finalize blocked while any contest submission is non-terminal |
| Override | Admin-only `force: true` on finalize API (emergency use) |
| Audit | Force-finalize **must** write an audit log entry |

**Audit log entry (minimum fields):**

```text
{
  contestId,
  actorUserId,
  forced: true,
  finalizedAt,
  pendingSubmissionCount,          // count at force time
  pendingSubmissionIds: [...],     // optional sample or full list per ops policy
  reason                           // admin-provided string, required when force=true
}
```

Persist audit log in MongoDB (dedicated collection or append-only admin audit trail). Implementation detail deferred to ISSUE-607; semantics are locked here.

### Treatment of queued/running submissions after force-finalization (locked)

Once a contest is `FINALIZED` with `force: true`:

| Submission state at force time | After force-finalize |
|--------------------------------|----------------------|
| `created` / `queued` / `running` | May still complete judging (worker obligation) |
| Terminal result arrives later | **Does not change standings** — scoring is frozen |
| Scoring service | No-op with audit log if invoked post-finalize |
| Standings snapshot | Reflects only submissions scored **before** finalization |
| Reconciliation | Does not retroactively score post-finalize terminal results |

Non-terminal submissions at force time are **excluded from contest standings permanently** for that contest. They remain in `Submission` history for operational/debug review only.

### Late worker after finalization

If a worker attempts to score after `FINALIZED`:
- `scoringService` checks contest status → no-op with audit log.
- Submission result may still persist (judge obligation) but does not change standings.

### Race: finalization during scoring

- Finalization acquires contest-level lock or checks `status !== FINALIZED` atomically before snapshot.
- Scoring checks `contest.status !== FINALIZED` on every apply.
- If scoring completes after snapshot started but before status flip, reconciliation before snapshot catches it.

---

## 17. Final standings snapshot design

### Role

`ContestLeaderboardSnapshot` is a **durable checkpoint**, not the live leaderboard.

### Types

| `isFinal` | When written |
|-----------|--------------|
| `false` | Optional periodic checkpoint during `RUNNING`/`ENDED` (admin or scheduled) — low priority |
| `true` | Exactly once at finalization |

### `standings[]` entry

```text
{
  userId,
  rank,
  solvedCount,
  score: solvedCount,           // reuse field; NOT points sum
  penalty: totalPenaltyMinutes,
  lastAcceptedAt: Date|null
}
```

### Not the live leaderboard

- Phase 6 standings API reads from `ContestParticipant` aggregates (sorted), not snapshot.
- Snapshot is for audit, history, rating input, and disaster recovery.
- Phase 7 Redis ZSET is a performance projection derived from the same aggregates.

---

## 18. Performance / 10k-participant analysis

### Assumptions

- 10,000 participants
- 5 problems
- ~8 submissions per participant per problem peak → up to 400,000 submissions (upper bound; many contests lower)

### Per accepted-first-solve event (hot path)

| Operation | Count |
|-----------|-------|
| Ledger insert | 1 |
| Submission query (wrong count + canonical AC) | 1 indexed |
| `ContestParticipantProblem` upsert | 1 |
| `ContestParticipant` update | 1 |
| **Total writes** | ~3-4 |

### Per wrong-attempt event (before solve)

| Operation | Count |
|-----------|-------|
| Ledger insert | 1 |
| **Total writes** | 1 |

Wrong attempts do not touch aggregate participant doc until solve — reduces contention on the standings sort key.

### Contention hotspots

| Hotspot | Risk | Mitigation |
|---------|------|------------|
| Single contest document | Low — read-mostly after start | Never write contest on each submission |
| `ContestParticipant` per user | Medium — one doc per user | Only update on solve, not every WA |
| `ContestLeaderboardSnapshot` | Low | Finalization + optional infrequent checkpoint only |
| Global standings sort | Read cost | Index-backed aggregate query; paginate; Phase 7 Redis for hot reads |

### Standings read (Phase 6 API)

```text
ContestParticipant.find({ contestId }).sort({ solvedCount: -1, totalPenalty: 1, ... })
```

With compound index — O(N log N) sort in Mongo for N=10k is acceptable for non-polling API (seconds-level refresh), not for sub-second live board (Phase 7).

---

## 19. Required Mongo indexes

### Existing (retain)

| Index | Query | Purpose |
|-------|-------|---------|
| `Submission.{ contestId, userId, contestProblemId, verdict }` | Wrong/solve replay per problem | Reconciliation |
| `Submission.{ contestId, status }` | Pending drain at finalization | Finalization gate |
| `ContestParticipant.{ contestId, userId }` unique | Participant lookup | Registration + aggregate fetch |

### New (justified by query)

| Index | Query | Purpose | Cardinality |
|-------|-------|---------|-------------|
| `ContestScoredSubmission.{ submissionId: 1 }` unique | Idempotency lookup | Duplicate protection | 1 per scored submission |
| `ContestScoredSubmission.{ contestId: 1, userId: 1 }` | Audit per participant | Debug | Medium |
| `ContestParticipantProblem.{ contestId, userId, contestProblemId }` unique | Per-problem state fetch/update | Hot path | ≤ problems × participants |
| `ContestParticipant.{ contestId, solvedCount: -1, totalPenalty: 1, lastAcceptedContestMs: 1, userId: 1 }` | Standings sort | Standings API | Per contest |
| `Submission.{ contestId, userId, contestProblemId, submittedAtContestMs: 1 }` | Canonical AC + wrong count | Solve computation | Per problem group |

Do not add speculative indexes beyond these patterns.

---

## 20. Failure scenarios

| Scenario | Behavior |
|----------|----------|
| Worker crash after Mongo submission result update, before scoring | Reconciliation sweep calls scoring for completed unscored contest submissions |
| Worker crash during scoring | Submission terminal; ledger may be missing → retry safe |
| Scoring service crash mid-write | Ledger insert first → retry completes or no-ops; partial participant update healed by reconcile |
| Duplicate scoring event | Ledger unique key → no-op |
| Out-of-order scoring event | §9 — deterministic |
| Mongo restart | All state durable; resume processing |
| Contest finalization during scoring | Status check + reconcile-before-snapshot |
| Redis unavailable | **No impact on Phase 6** — Mongo authoritative |

---

## 21. Rating boundary

Rating is **out of scope**.

Future rating consumer reads:
- `ContestLeaderboardSnapshot` where `isFinal: true`
- Or reconciled `ContestParticipant` aggregates

It must **not** read Redis live leaderboard or re-score submissions.

```text
Contest scoring (Phase 6) → Final snapshot → Rating engine (future)
```

No `User.rating` mutation in Phase 6.

---

## 22. API impact (conceptual — Phase 6)

### New endpoints

| Method | Path | Auth | Source | Notes |
|--------|------|------|--------|-------|
| `GET` | `/api/v1/contests/:contestId/standings` | **Public** | Mongo aggregates | Paginated; `?page=&limit=` |
| `GET` | `/api/v1/contests/:contestId/standings/me` | **Required** | Mongo | Authenticated participant rank |

### Standings visibility policy (locked)

| Endpoint | Access | Contest-state rules |
|----------|--------|---------------------|
| `GET /standings` | Public (no auth) | Readable for contests in `RUNNING`, `ENDED`, or `FINALIZED`. `DRAFT`/`SCHEDULED`/`REGISTRATION` may return empty or 404 per existing contest visibility conventions. |
| `GET /standings/me` | Authenticated participant | Same contest-state visibility as public standings; returns caller's rank even if not in top page. |

Respect Phase 5 contest metadata visibility: standings expose ranks and scores only — not hidden test data or submission code.

### Unregister policy (locked)

| Contest status | Unregister |
|----------------|------------|
| `DRAFT`, `SCHEDULED`, `REGISTRATION` | **Allowed** |
| `RUNNING`, `ENDED`, `FINALIZED` | **Blocked** |

Phase 6 does **not** implement retroactive score removal, disqualification, or standings exclusion for previously registered participants. Disqualification is a future extension.

### Admin finalize extension

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/admin/contests/:id/finalize` | Body may include `{ "force": true, "reason": "..." }` for emergency force-finalize |

### Response shape (conceptual)

```json
{
  "contestId": "...",
  "status": "RUNNING",
  "standings": [
    {
      "rank": 1,
      "userId": "...",
      "solvedCount": 3,
      "penalty": 127,
      "lastAcceptedAt": "2026-08-31T12:45:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 10000 }
}
```

### Unchanged

- Submission endpoints
- Registration endpoints (unregister restricted to pre-`RUNNING` per locked policy)
- Admin finalize endpoint (extended: snapshot + drain check + optional `force: true`)

### Phase 7 dependency

Redis-backed sub-second leaderboard remains Phase 7. Phase 6 API is correct but not optimized for 10k concurrent pollers.

---

## 23. Security / fairness

| Risk | Mitigation |
|------|------------|
| Client-provided timestamps | Ignored; only `submittedAtContestMs` computed server-side at intake |
| Client-provided scores | No score input API |
| Forged contest problem IDs | Validated at submission intake against `Contest.problems` |
| Replayed submissions | New submission doc; scoring uses submission ID ledger |
| Duplicate result processing | Submission terminal guard + scoring ledger |
| Submission after contest end | Rejected in `createContestSubmission` when not `RUNNING` |
| Unauthorized scoring mutation | No public scoring API; service internal only |
| Admin finalization bypass | Admin role + reconcile gate |

All scoring decisions are server-authoritative.

---

## 24. Phase 6 dependency graph

```text
Scoring contract (ICPC semantics)
       │
       ▼
Scoring state model
(ContestParticipantProblem, ContestParticipant aggregates, ContestScoredSubmission ledger)
       │
       ▼
Judge-result integration
(updateSubmission → scoringService.applySubmissionResult)
       │
       ├── Idempotency (ledger unique submissionId)
       │
       ├── Out-of-order handling (canonical AC + query-derived wrong count)
       │
       └── Concurrent updates (conditional solves, per-problem docs)
       │
       ▼
Reconciliation / rebuild
       │
       ▼
Finalization integration
(drain check → reconcile → snapshot → FINALIZED)
       │
       ▼
Authoritative standings API (Mongo)
       │
       ▼
[Phase 7: Redis leaderboard projection]
       │
       ▼
[Phase 8: SSE]
```

---

## 25. Implementation order

1. **Scoring contract** — constants, verdict mapping, penalty formula (shared module).
2. **State models** — `ContestParticipantProblem`, `ContestScoredSubmission`, extend `ContestParticipant`.
3. **Indexes** — create alongside models.
4. **Scoring service** — pure `applySubmissionResult`, unit-testable.
5. **Idempotency** — state-first apply with aggregate reconciliation; ledger records per-submission processing.
6. **Judge integration** — hook after `updateSubmission` success in shared path.
7. **Out-of-order tests** — WA/AC permutations, duplicate replay.
8. **Reconciliation service** — full contest rebuild + drift detection.
9. **Finalization** — drain check, snapshot write, scoring freeze guard.
10. **Standings API** — Mongo read path.
11. **Integration tests** — end-to-end contest submission → score → standings.

Priorities: correctness → idempotency → determinism → recovery → performance.

---

## 26. Locked decisions (all approved)

### Core scoring (Phase 6 review)

| Decision | Status |
|----------|--------|
| ICPC vs points scoring | **Locked: ICPC penalty** |
| Wrong verdict set includes CE/RE/TLE/MLE | **Locked: Yes** |
| Post-solve submissions ignored | **Locked: Yes** |
| Synchronous scoring in worker path | **Locked: Yes for Phase 6** |
| `score` field = solvedCount in snapshot | **Locked: Yes** |
| Competition ranking vs dense ranking | **Locked: Competition ranking** |

### Product policy (approved after Phase 6 review)

| # | Decision | Locked policy |
|---|----------|---------------|
| 1 | **Force-finalize** | Strict drain by default. Admin-only `force: true` for emergency finalization. Force-finalize must create an audit log. Queued/running submissions at force time are permanently excluded from standings; may still judge but cannot change score after `FINALIZED`. |
| 2 | **Unregister / disqualification** | Unregister allowed only before `RUNNING`. Blocked once `RUNNING`. No retroactive score removal in Phase 6. Disqualification deferred to a later phase. |
| 3 | **Standings visibility** | `GET /standings` is public. `GET /standings/me` requires authentication. Respect contest-state visibility rules from Phase 5. |
| 4 | **Future points-based scoring** | Defer `Contest.scoringMode`. Phase 6 implements ICPC-style scoring only. Do not add speculative points-based fields or logic. `Contest.problems[].points` remains unused for ranking. |

---

## 27. Remaining risks (technical only)

1. **Synchronous scoring in workers** — if scoring grows heavy, move to `scoring-queue` without changing semantics.
2. **Periodic non-final snapshots** — optional; not required for MVP.
3. **Audit log storage shape** — collection vs embedded admin log is an implementation choice under ISSUE-607; semantics above are fixed.

---

## 28. Final architecture diagram

```text
                    JUDGE (workers)
                         │
                         ▼
              updateSubmission (terminal)
              [existing idempotent guard]
                         │
                         ▼
              ┌──────────────────────┐
              │   Scoring Engine     │
              │  scoringService.js   │
              └──────────┬───────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
 ContestScored    ContestParticipant   ContestParticipant
 Submission       (aggregate)          Problem (per-problem)
 ledger
         │               │               │
         └───────────────┴───────────────┘
                         │
                         ▼
                   MongoDB
                 AUTHORITATIVE
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
   ContestLeaderboardSnapshot   Standings API
   (final checkpoint)           (Phase 6)
              │
              ▼
        [Phase 7 Redis ZSET]
              │
              ▼
        [Phase 8 SSE]
              │
              ▼
           Frontend
```

---

## Summary

Phase 6 implements ACM/ICPC-style penalty scoring as authoritative MongoDB projections, triggered after terminal submission results, with ledger-based idempotency and submission-history-derived penalty counts for ordering independence. `Submission` remains the audit log; `ContestParticipantProblem` and `ContestParticipant` are rebuildable projections; `ContestLeaderboardSnapshot` captures the final durable record at finalization. Redis, SSE, and rating are explicitly downstream.

### Implementation checkpoint

- **ISSUE-601 ✅** — shared scoring contract in `packages/shared/contracts/scoring.js`
- **ISSUE-602 ✅** — `ContestParticipantProblem`, `ContestScoredSubmission`, extended `ContestParticipant`, indexes
- **ISSUE-603 ✅** — `applySubmissionResult` processor, `updateSubmission` scoring hook, `backend/test_scoring_engine.js`
- **ISSUE-604 ✅** — idempotent processing with `reconcileParticipantAggregate()` and duplicate-ledger reconcile-on-retry
- **ISSUE-605+** — pending (out-of-order hardening, reconciliation, finalization snapshot, standings API)
