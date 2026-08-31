# Phase 5 Contest Engine Architecture Review

Status: architecture review only. No implementation code was changed.

## Scope and guardrails

This review is intentionally limited to the authoritative contest domain and the dependency plan needed before Phase 5 implementation begins.

Out of scope for this phase:
- Redis leaderboard implementation
- Redis Streams/SSE delivery
- frontend contest UX
- rating calculation
- 10k-user load testing
- contest-specific worker queues or redesigns

The current codebase already contains the required foundation models and contest metadata fields:
- `packages/shared/models/Contest.js`
- `packages/shared/models/ContestParticipant.js`
- `packages/shared/models/ContestLeaderboardSnapshot.js`
- `packages/shared/models/Submission.js`
- `backend/models/User.js`
- `packages/shared/models/Question.js`

## 1. Current contest-model audit

The repo is aligned with the Phase 1 database foundation and already contains the authoritative contest model primitives:

- `Contest`
  - `title`, `slug`, `description`, `registrationOpenTime`, `startTime`, `endTime`, `status`, `problems[]`, `createdBy`
  - status enum includes `DRAFT`, `SCHEDULED`, `REGISTRATION`, `RUNNING`, `ENDED`, `FINALIZED`
  - `problems[]` is embedded and contains `questionId`, `order`, `points`, `penaltyMinutes`
  - `Contest.problems` should be treated as stable contest-scoped problem definitions, not mutable per-submission state

- `ContestParticipant`
  - `contestId`, `userId`, `registeredAt`
  - unique compound index on `{ contestId, userId }`
  - additional `{ userId }` index for history queries

- `ContestLeaderboardSnapshot`
  - `contestId`, `takenAt`, `isFinal`, `standings[]`
  - snapshots are durable MongoDB records and not the live leaderboard source

- `Submission`
  - includes `contestId`, `contestProblemId`, `submittedAtContestMs`
  - nullable by design for practice submissions
  - lifecycle status uses `CREATED`, `QUEUED`, `RUNNING`, `COMPLETED`
  - `verdict` remains the terminal judge result (Accepted / Wrong Answer / Runtime Error / etc.)

- `User`
  - currently includes `rating`, `contestsParticipated`, and `highestRating`
  - defaults align with the contest-foundation requirement

The repo does not yet implement the contest engine behavior itself; it has the authoritative domain schema and the right boundary between MongoDB as source-of-truth and Redis as a live operational projection.

## 2. Proposed contest lifecycle

State machine:

DRAFT
  -> SCHEDULED
  -> REGISTRATION
  -> RUNNING
  -> ENDED
  -> FINALIZED

Recommended validity rules:
- `DRAFT` is admin-editable only.
- `SCHEDULED` means the contest is announced but registration is not yet open unless the scheduler sets the state accordingly.
- `REGISTRATION` is the open-registration window.
- `RUNNING` starts exactly when `startTime <= serverTime < endTime`.
- `ENDED` is a terminal contest window state reached when endTime has passed and no more submissions are accepted; it is not yet the final leaderboard lock.
- `FINALIZED` is the irreversible lock done after contest review and final standings snapshot.

Rules:
- Only an admin or scheduler can perform lifecycle transitions.
- Every transition must use server-authoritative time, not client clocks.
- Invalid transitions (for example `RUNNING -> REGISTRATION`, `ENDED -> RUNNING`, `FINALIZED -> RUNNING`) must be rejected.
- A contest should never be reopened once finalized.
- Contest status changes are persistence-level state changes, not only UI toggles.

## 3. Proposed participant lifecycle

Contest registration is modeled as an existence check on `ContestParticipant` rather than a mutable inline flag.

Lifecycle:
- unauthenticated user: not eligible
- authenticated user: eligible if contest is in registration window and not already registered
- registration creates a `ContestParticipant` document with unique `(contestId, userId)`
- duplicate registration attempts return `409` and are idempotent at the DB level
- registration is not a queue event; it is a Mongo write followed by an audit trail
- contest submission checks must verify registration server-side each time

Not recommended in this phase:
- temporary unregister flows unless required by product rules
- disqualification logic beyond an explicit admin action
- participant state fields that duplicate standings data

## 4. Contest-problem design

The embedded `Contest.problems[]` design is the correct shape for the current repo.

Reasons:
- contest problems are part of the contest as an atomic unit
- the list is small and read together with contest metadata
- a contest problem must remain stable throughout the contest
- the embedded pattern supports `contestProblemId` as the stable subdocument `_id`

Recommended rule:
- a contest problem is immutable after the contest enters `REGISTRATION` or `RUNNING`
- problem ordering is authoritative in `Contest.problems[].order`
- points and penaltyMinutes are contest-specific and must not be inferred from the question model itself
- `questionId` points to a canonical question document, but the contest binding is the stable contest subdocument identity

## 5. Submission integration

Submission semantics should remain:
- practice submission: `contestId = null`, `contestProblemId = null`, `submittedAtContestMs = null`
- contest submission: `contestId != null`, `contestProblemId != null`, `submittedAtContestMs` computed from server-authoritative contest-relative time

Server-side validation rules:
- contest must exist
- contest must be `RUNNING`
- user must be registered
- `contestProblemId` must belong to that contest
- `questionId` must resolve to the actual question bound to the contest
- no direct client trust for contest-relative milliseconds; compute server-side from `contest.startTime`

The submission pipeline should remain submission-agnostic: the judge worker executes code, and contest logic is calculated outside the judge path using completion events.

## 6. Server-authoritative timing model

The codebase already requires server-authoritative timing if contest submissions are to be fair.

Rules:
- compute `submittedAtContestMs` as `serverNow - contest.startTime` in milliseconds
- reject submission requests whose clock is obviously wrong or stale by using server-time validation only
- the worker must not use client timestamps for ranking or scoring
- if a submission is queued or judged after the contest end, it is still valid only if the submission attempt was admitted before the contest closed, and the contest engine explicitly decides whether late-worker processing is accepted or rejected

Recommended authoritative rule:
- admission time decides validity, not execution completion time
- if the submission is accepted before `endTime` and the worker processes later, the result still belongs to the contest as long as the submission was still valid at intake
- if the worker or queue state is stale and the contest has already ended, the system should treat the submission as a late-arrived but previously accepted attempt, not a new valid contest submission

This rule keeps the contest fair while preserving the backend's eventual consistency path.

## 7. Queue interaction

The current queue architecture remains the right integration point:

Submission creation -> Mongo authoritatively stores the submission -> queue job -> worker executes -> result update -> scoring consumer decides contest impact

Important constraints:
- do not create a separate contest-specific queue unless there is a concrete bottleneck proving it is necessary
- queue health is operational, not source-of-truth
- submission completion is the trigger for contest scoring, not queue status itself
- duplicate or replayed job events must be protected by idempotent scoring logic

Recommended behavior:
- queue job creation must remain deterministic and idempotent with the language + submission pair
- if the queue is unavailable, submission remains in a transient `CREATED`/`QUEUED`-failed state until reconciliation or rejection logic resolves it
- contest finalization should not silently drop valid queued submissions that were accepted before endTime; the queue/worker path should resolve this deterministically based on auth state and submission timestamps

## 8. Scoring boundary

The scoring boundary should remain separate from the judge itself.

The judge path should only produce:
- submission result
- verdict
- passed/failed test data
- runtime and memory stats

Contest scoring should then consume the completed result and compute:
- accepted vs rejected
- solved state
- wrong-attempt counts
- penalty calculation
- leaderboard projection

This keeps the judge model pure and avoids mixing runtime evaluation concerns with contest ranking logic.

Recommended authoritative principle:
- scoring is derived from submissions + contest metadata
- Redis is a live projection, not the permanent source of truth
- finalization writes a durable `ContestLeaderboardSnapshot`

## 9. Finalization architecture

Recommended lifecycle:

RUNNING -> ENDED -> FINALIZED

Rules:
- finalization is an admin-reviewed action, not a blind automatic transition
- finalization is triggered only after the end window and after any late-submission policies are resolved
- queued or running jobs should be drained or marked according to policy, but must not mutate the final standings after finalization is locked
- the final snapshot should be persisted as `ContestLeaderboardSnapshot{ isFinal: true }`
- repeated finalization attempts are rejected

The final snapshot should remain the durable historical record; Redis leaderboard values can be retained temporarily for recovery but must not be treated as the canonical result.

## 10. Failure recovery

A contest must recover from:
- API restarts
- MongoDB restarts
- Redis restarts
- worker restarts
- scheduler restarts

All recovery must be based on authoritative MongoDB state.

Design rules:
- Redis may be rebuilt from Mongo and contest state, not vice versa
- leaderboard snapshots can regenerate from persisted contest submissions and the contest's underlying data
- if the contest scheduler is unavailable, the system must not trust a stale in-memory state; instead read `Contest.status` from Mongo and compute actual state from contest times
- if workers are down, pending or queued contest submissions remain in authoritative DB state and reconcile on restart

## 11. Authorization model

Contest permissions should remain explicit and separate from business logic:
- admin: create/edit/manage lifecycle and finalization
- authenticated user: register, view own contest state, submit within rules
- public: read contest metadata and public standings if allowed by product policy

Rules:
- auth is enforced before contest business validation
- contest-specific policy checks happen after authentication and before mutation
- avoid embedding contest policy in generic route middleware

## 12. Required indexes

The repo already contains the right core indexes for contest foundation. The phase-5 review keeps them authoritative and documents query intent.

- `{ contestId: 1, userId: 1 }` unique on `ContestParticipant`
  - query: `findOne({ contestId, userId })` for registration validation
- `{ userId: 1 }` on `ContestParticipant`
  - query: list member contest history for a user
- `{ contestId: 1, isFinal: 1 }` on `ContestLeaderboardSnapshot`
  - query: final snapshot lookup during post-contest reads
- `{ contestId: 1, takenAt: -1 }` on `ContestLeaderboardSnapshot`
  - query: most recent historical standings read
- `{ userId: 1, createdAt: -1 }` on `Submission`
  - query: user submission history
- `{ userId: 1, questionId: 1 }` on `Submission`
  - query: one user's submissions for one problem
- `{ contestId: 1, userId: 1, contestProblemId: 1, verdict: 1 }` on `Submission`
  - query: contest scoring and solved-state reconciliation
- `{ contestId: 1, status: 1 }` on `Submission`
  - query: active submissions in a contest
- `{ status: 1, createdAt: 1 }` on `Submission`
  - query: reconciliation sweep for queued/created submissions
- `{ status: 1, startTime: 1 }` on `Contest`
  - query: contest scheduler and lifecycle selection

Any later index must be justified by an actual query pattern, not by a speculative contest-architecture assumption.

## 13. API design

Conceptual API boundaries:

Admin APIs:
- `POST /admin/contests`
- `PATCH /admin/contests/:id`
- `POST /admin/contests/:id/start`
- `POST /admin/contests/:id/end`
- `POST /admin/contests/:id/finalize`

Public/read APIs:
- `GET /api/v1/contests`
- `GET /api/v1/contests/:slug`
- `GET /api/v1/contests/:id/problems`
- `GET /api/v1/contests/:id/standings`

Participant APIs:
- `POST /api/v1/contests/:id/register`
- `DELETE /api/v1/contests/:id/register`
- `POST /api/v1/contests/:id/submissions/:problemId`
- `GET /api/v1/contests/:id/submissions`
- `GET /api/v1/contests/:id/standings/me`

Important: the API layer must remain thin; contest enforcement belongs in service-level validation, not in ad hoc route checks.

## 14. 10k-participant considerations

The contest engine should treat read and write paths differently.

High-concurrency operations:
- registration
- contest start/end status transitions
- leaderboard reads
- score updates
- finalization

Operations that must remain indexed and cheap:
- `ContestParticipant` lookup by `(contestId, userId)`
- `Submission` lookup by contest + user + problem + verdict
- `Contest` status/time reads for scheduler checks
- leaderboard top-N reads in Redis, not Mongo

The biggest risk is not the number of participants alone but the number of writes and ranking updates under submission bursts. The authoritative contest engine therefore favors:
- MongoDB for durable truth
- Redis sorted-set leaderboard for ranking hot path
- snapshotting and finalization as low-frequency durable writes

## 15. Dependency graph

```text
Contest domain
  ├── Lifecycle / scheduling
  ├── Problems / binding
  ├── Participant registration
  ├── Submission validation
  ├── Queue integration
  ├── Result processing
  ├── Contest scoring
  ├── Leaderboard projection
  ├── Finalization
  └── Authorization + API
```

The dependency order is:
1. contest model integrity
2. lifecycle and scheduling
3. participant registration
4. contest submission validation
5. queue integration
6. result processing
7. scoring boundary
8. leaderboard projection
9. finalization
10. authorization, API, and failure recovery

## 16. Implementation order

Recommended safe order:
1. finalize contest lifecycle and scheduler semantics
2. confirm contest-problem immutability and binding rules
3. lock participant registration and duplicate guards
4. implement contest submission validation rules
5. wire contest submissions to the existing queue system
6. add idempotent result handling and final-result protection
7. add scoring consumer boundary and leaderboard projection
8. add finalization and snapshot persistence
9. add failure-recovery, authorization, and API layers
10. only then proceed to SSE/leaderboard delivery and frontend integration

This ordering minimizes incorrect contest state and keeps the authoritative domain clean before any high-scale projection layer is introduced.

## 17. Decisions requiring approval

Before implementation begins, the repository should confirm:
- scoring model: ICPC-style penalty vs points-based scoring
- contest leaderboard visibility rules
- whether finalization is automatic or admin-reviewed
- whether late submissions after contest end are accepted or rejected once admitted
- how to handle delayed worker execution after the endTime window

## 18. Risks and unresolved questions

- scoring model decision is still an explicit product choice
- whether contest standings should be public or authenticated is a policy decision
- late-worker execution must be formally defined
- queue outage recovery must be explicit for contest submissions that were created but not enqueued
- finalization should be reviewed before it becomes irreversible

## Summary

The repo already has the correct contest-domain primitives and the right separation between authoritative MongoDB state and operational Redis projections. The next implementation phase should focus on correctness, server-authoritative timing, and finalization semantics—without introducing leaderboard, SSE, or frontend features before the contest engine is complete.
