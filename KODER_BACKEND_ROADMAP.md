# Koder — Master Backend Architecture & Scalability Roadmap

**Status:** Phases 1–5 implementation complete. Phase 6 scoring foundation (ISSUE-601/602/603/604) implemented. ISSUE-605+ pending. Redis leaderboard (Phase 7), SSE (Phase 8), and frontend contest features remain later phases.
**Grounded in:** direct inspection of the `koder-main` repository snapshot (backend, workers, packages/shared, frontend, docker-compose, README.md, ISSUES.md). Every claim about "current behavior" below is cited to a file path. Nothing about a typical online judge is assumed if it isn't in the code.
**Numbering:** `ISSUES.md` already documents ISSUE-001 through ISSUE-015 (all closed). New issues in this roadmap are numbered **ISSUE-101+** to avoid collision.

## Phase 5 — Contest Engine ✅ COMPLETE

Implemented and verified:
- Contest lifecycle (`DRAFT` → `FINALIZED`) with server-time sync
- Participant registration (unique per contest)
- Contest problem binding and immutability after start
- Contest submission validation (`RUNNING`, registered, valid `contestProblemId`)
- Server-derived `submittedAtContestMs` at intake
- Queue integration via existing BullMQ adapter
- Finalization boundary (`ENDED` → `FINALIZED`, idempotent)

See `backend/services/contest.service.js`, `backend/test_contest_engine.js`, and `PHASE_5_CONTEST_ENGINE.md`.

Scoring was intentionally deferred to Phase 6.

---

## Phase 6 — Scoring Engine (ISSUE-601/602/603/604 implemented)

**Authoritative document:** `PHASE_6_SCORING_ENGINE.md`

### Implemented (ISSUE-601 / ISSUE-602 / ISSUE-603 / ISSUE-604)

- `packages/shared/contracts/scoring.js` — ICPC penalty helpers, verdict classification, canonical ordering, tie-break/rank utilities
- `ContestParticipantProblem`, `ContestScoredSubmission` models + extended `ContestParticipant` aggregates
- Scoring-related indexes on `Submission`, `ContestParticipant`, and new collections
- `packages/shared/scoring/applySubmissionResult.js` — contest scoring processor with `reconcileParticipantAggregate()`
- `packages/shared/db/dbCalls.js` — post-`updateSubmission` scoring hook for workers
- Tests: `backend/test_scoring_contract.js`, `backend/test_scoring_models.js`, `backend/test_scoring_engine.js`

### Still pending (ISSUE-605+)

- Out-of-order hardening tests, reconciliation service, finalization snapshot writes, standings API

### Decision locked in Phase 6 review

| Topic | Decision |
|-------|----------|
| Scoring model | **ACM/ICPC-style penalty** (not points-based) |
| Solved definition | Terminal verdict `Accepted` only |
| Timing | `submittedAtContestMs` at submission intake (not worker time) |
| Post-solve submissions | Ignored for scoring |
| Authoritative state | `ContestParticipantProblem` + `ContestParticipant` aggregates + `ContestScoredSubmission` ledger |
| Idempotency | Unique ledger per `submissionId` + conditional solve updates |
| Transactions | Not required for steady-state scoring |
| Trigger | Post-`updateSubmission` scoring service call when `contestId` set |
| Finalization | Strict drain → reconcile → snapshot → freeze; admin `force: true` with audit log |
| Force-finalize pending subs | Permanently excluded from standings; may still judge; no post-finalize score change |
| Unregister | Allowed only before `RUNNING`; no disqualification in Phase 6 |
| Standings API | `GET /standings` public; `GET /standings/me` authenticated |
| Points-based future | Defer `scoringMode`; ICPC-only in Phase 6; no speculative fields |
| Redis | Phase 7 projection only — not required for Phase 6 correctness |

### Current gap (ISSUE-605+)

- `finalizeContest()` does not write snapshot or enforce drain policy
- `submissionEventPublisher` remains unwired
- Standings API not implemented
- Full contest reconciliation service not implemented

### Phase 6 issues

ISSUE-601 through ISSUE-609 in `ISSUES.md`.

### Architecture boundary

```text
Judge → Submission result → Scoring Engine → MongoDB (authoritative)
                                              → [Phase 7 Redis]
                                              → [Phase 8 SSE]
```

No implementation code for Redis leaderboard, SSE, rating, or frontend in Phase 6. Worker scoring integration is complete at ISSUE-603.

---

## Phase 6 implementation status (ISSUE-601 / ISSUE-602 / ISSUE-603 / ISSUE-604)

| Deliverable | Location |
|-------------|----------|
| Scoring contract | `packages/shared/contracts/scoring.js` |
| Per-problem state | `packages/shared/models/ContestParticipantProblem.js` |
| Idempotency ledger | `packages/shared/models/ContestScoredSubmission.js` |
| Participant aggregates | `packages/shared/models/ContestParticipant.js` (`solvedCount`, `totalPenalty`, `lastAcceptedContestMs`) |
| Submission timing index | `packages/shared/models/Submission.js` — `{ contestId, userId, contestProblemId, submittedAtContestMs }` |
| Scoring processor | `packages/shared/scoring/applySubmissionResult.js` |
| Aggregate reconciliation | `reconcileParticipantAggregate()` in `packages/shared/scoring/applySubmissionResult.js` |
| Worker integration hook | `packages/shared/db/dbCalls.js` (`triggerContestScoring` after terminal `updateSubmission`) |
| Contract tests | `backend/test_scoring_contract.js` |
| Model tests | `backend/test_scoring_models.js` |
| Integration tests | `backend/test_scoring_engine.js` |

ISSUE-604 (idempotent processing + partial-failure healing) is implemented and verified.

---

## 1. Executive Summary

Koder today is a working, single-tenant-scale online judge: Next.js frontend → Express API → MongoDB, with submissions dispatched over three BullMQ queues (`js-queue`, `java-queue`, `python-queue`) to one worker process per language, each of which executes untrusted code in a hardened, single-use Docker container using a custom line-streaming protocol (BLSP). The security model (network-isolated, read-only, non-root, capability-dropped containers) is solid and should be preserved. The architectural gaps are specifically the ones you'd expect from a system built for correctness first: **no contest concept exists at all** (no Contest, registration, or scoring model), **no real-time layer** (the frontend polls a single submission every second), **no database indexes** beyond three uniqueness constraints, **hardcoded worker concurrency of 1 per language process**, and **no queue job options** (no retries, no backoff, no priority, no TTL-based cleanup of finished jobs in Redis).

None of this is a rewrite. The submission pipeline, the DockerSandbox security model, and the shared-package boundary (`@koder/shared`) are sound and are reused, not replaced. The roadmap below adds: a real database schema for contests and ranking, a genuine job-queue configuration (retries, priorities, backpressure), horizontally-scalable workers, a Redis-backed leaderboard that never recomputes from Mongo per submission, and an SSE-based event layer — in that order, because each layer depends on the one before it.

## 2. Current Architecture (as implemented, not idealized)

```
Next.js frontend (client-side polling, 1000ms interval, per submission)
        │  fetch() with credentials:"include" (cookie auth)
        ▼
Express API — backend/app.js
   /api/v1/auth        (backend/routes/auth.route.js)
   /api/v1/user         (backend/routes/user.route.js)
   /api/v1/questions    (backend/routes/question.route.js)
   /api/v1/submissions  (backend/routes/submission.route.js)
   /admin/*             (backend/routes/admin.route.js, authMiddleware + adminMiddleware)
        │
        ├─► MongoDB (mongoose, single connection, backend/db.js)
        │      Collections: users, questions, submissions
        │
        └─► BullMQ Queue.add("execute", { submissionId }) — no job options passed
               (backend/queue.js → js-queue / java-queue / python-queue, ioredis conn)
                        │
                        ▼
        Worker processes (one Node process per language, workers/{js,java,python}/worker.js)
           BullMQ Worker(queueName, processor) — no concurrency option ⇒ BullMQ default = 1
                        │
                        ▼
        workers/common/executionEngine.js — createExecutionExecutor()
           1. getQuestionDetails(submissionId) — 2 sequential Mongo reads (submission, then question)
           2. buildSource() — generates language runner via packages/shared/engine/templateGenerator.js
           3. createSandbox(`${language}-${jobId}`) — mkdir workers/common/temp/<key>, path-traversal-checked
           4. new DockerSandbox({...}).start() — `docker run -d --rm --network none --cap-drop ALL
              --security-opt no-new-privileges --user 1000:1000 --read-only --tmpfs /tmp:64m
              --memory=256m --cpus=1 --pids-limit=64 -v <jobDir>:/app sleep 120`
           5. (Java only) sandbox.exec(["javac","Main.java"], 25s watchdog)
           6. sandbox.runInteractiveBatch(execCommand, testcases, batchSize=50)
                 — `docker exec -i <container>` once per batch, BLSP line protocol over stdin/stdout,
                   2000ms per-test watchdog, 45000ms overall submission deadline
           7. compareOutputs() — exact / trimmed / JSON-equivalent / boolean / whitespace-array comparison
           8. updateSubmission(submissionId, result) — single Mongo write, status forced to "completed"
           9. finally: sandbox.destroy() (`docker rm -f`), cleanupSandbox() (`fs.rmSync` on temp dir)
        │
        ▼
   MongoDB submissions collection updated (status, verdict, passed/total, runtimes, failedTestCase)
        │
        ▼
   Frontend polls GET /api/v1/submissions/:id every 1000ms until status === "completed"
```

### Component-by-component

| Component | Responsibility | Files | Failure modes today |
|---|---|---|---|
| Express API | Auth, CRUD for questions, submission intake, admin CRUD | `backend/app.js`, `backend/routes/*` | Single process, no clustering configured; `app.listen(5000)` hardcoded in `server.js` |
| Auth | JWT in httpOnly cookie, bcrypt(12) password hashing | `backend/routes/auth.route.js`, `backend/middleware.js` | No rate limiting on `/signin`/`/signup` (brute force is unmitigated); 30-day JWT with no revocation/blacklist |
| Submission intake | Validates language, creates `Submission` doc, enqueues job | `backend/routes/submission.route.js` | No idempotency key — a client retry on a flaky network response creates a duplicate submission and duplicate judge run; `Queue.add` passes **no options** (no `attempts`, no `backoff`, no `removeOnComplete`) |
| Queue | BullMQ over ioredis, one queue per language | `backend/queue.js`, `packages/shared/config/queues.js` | Jobs and their return values are retained in Redis forever (BullMQ default) — unbounded Redis growth under sustained load; a failed job is **not retried** (default `attempts: 1`) |
| Worker | Pulls jobs, orchestrates one Docker execution per job | `workers/*/worker.js`, `workers/common/workerFactory.js` | **Concurrency is BullMQ's implicit default of 1** — confirmed: no `concurrency` option is passed to `new Worker(...)` anywhere. Three language processes ⇒ hard ceiling of 3 concurrent judge executions cluster-wide, regardless of host CPU headroom |
| DockerSandbox | One container per submission, BLSP-streamed batches | `workers/common/dockerSandbox.js` | Solid isolation (`--network none`, `--cap-drop ALL`, `--read-only`, `--user 1000:1000`, memory/CPU/pids caps). No per-host admission control — nothing currently prevents oversubscribing a host if concurrency is raised naively |
| Data model | `User`, `Question`, `Submission` (shared package) | `packages/shared/models/*.js` | **Zero secondary indexes** anywhere in the codebase — grep confirms only Mongoose-implicit `_id` and the three declared `unique: true` fields (`User.email`, `Question.questionNum`, `Question.slug`) exist. `Submission` has no index on `userId`, `questionId`, `status`, or `createdAt` |
| Frontend submission UX | Create submission, then client-side poll | `frontend/app/problems/[slug]/page.tsx` | Polls **every submission page independently at 1000ms**; checks for `status === "failed"`, a value that **does not exist** in `SUBMISSION_STATUS` (dead/incorrect branch — verdict-based failures still resolve via `"completed"`) |
| Contest system | **Does not exist.** No `Contest`, `ContestProblem`, `ContestParticipant`, `ContestSubmission`, or `Leaderboard` model or route anywhere in the repository. | — | N/A — this is 100% new work, not a modification |
| Real-time layer | **Does not exist.** No WebSocket or SSE server; `Header.tsx`/pages contain no socket client. | — | N/A — new work |
| Rate limiting | **Does not exist** on any route. | — | Auth and submission endpoints are unprotected against abuse |
| Observability | `console.log`/`console.error` only. No metrics, no health endpoint, no structured logs. | — | No visibility into queue depth, job latency, or judge failure rate today |

### `SUBMISSION_STATUS` is effectively binary, not the 5-state machine the task brief assumed

`packages/shared/contracts/verdicts.js` defines `PENDING`, `RUNNING`, `COMPLETED`. But `RUNNING` is **never set** anywhere in `executionEngine.js` or `workerFactory.js` — confirmed by grep across `backend/`, `workers/`, `packages/`. A submission goes `pending` → `completed` with no observable "currently executing in a container" state. This matters directly for Phase 1: the roadmap's `QUEUED`/`RUNNING` states below are **new**, not a rename of something that already worked.

## 3. Current Limitations (consolidated)

1. Worker concurrency hardcoded to BullMQ's default of 1, times 3 language processes = 3 concurrent judge executions, cluster-wide, full stop.
2. No horizontal worker scaling story: nothing prevents running a second worker process against the same queue name today (BullMQ workers on the same queue name naturally share load), but it is undocumented, unconfigured, and the per-host resource governor needed to do it safely doesn't exist.
3. No Mongo indexes beyond three `unique: true` fields. `user.route.js`'s `/stats` endpoint runs `Submission.find({ userId })` with **no limit**, loading every submission a user has ever made into Node memory on every dashboard load.
4. No BullMQ job options: no `attempts`/`backoff` (a worker crash mid-job means a permanently stuck `pending` submission unless the `failed` handler fires, which only covers processor exceptions, not process death), no `removeOnComplete`/`removeOnFail` (Redis grows without bound), no `priority`, no rate limiter, no per-user submission throttling.
5. No idempotency on submission creation — a client-side retry creates a second `Submission` document and a second judge run.
6. No Contest/registration/scoring/leaderboard data model at all.
7. No real-time delivery — the current UX model (poll one submission id every second) does not extend to "10,000 users watching a live leaderboard."
8. No rate limiting on `/api/v1/auth/*` or `/api/v1/submissions/*`.
9. Dead code / contract drift: frontend checks for a `"failed"` submission status that the shared contract does not define.
10. No caching of read-heavy, rarely-changing data (`Question` documents) — every problem-page load and every judge execution's `getQuestionDetails` call hits Mongo directly.
11. No structured logging, metrics, or health/readiness endpoints.
12. No CI (confirmed absent in README's own Limitations section) — relevant because horizontal scaling changes and queue-option changes are exactly the kind of change that silently regresses without CI.

## 4. Target Architecture

```
                                   ┌─────────────────────────────┐
                                   │   Next.js frontend (SSR +   │
                                   │   SSE client for live data) │
                                   └───────────────┬─────────────┘
                                                    │ REST (unchanged surface) + SSE stream
                                                    ▼
                          ┌────────────────────────────────────────────┐
                          │     Express API — modular monolith          │
                          │  Auth · User · Problem · Submission ·       │
                          │  Contest · Leaderboard(read) · Admin ·      │
                          │  Events(SSE)                                │
                          │  — stateless, horizontally scaled behind LB │
                          └───────┬───────────────┬──────────┬─────────┘
                                  │               │          │
                     writes/reads│    enqueue     │  pub/sub │ leaderboard read/write
                                  ▼               ▼          ▼
                          ┌───────────┐   ┌───────────┐  ┌──────────────────┐
                          │  MongoDB  │   │  BullMQ    │  │  Redis            │
                          │ (source   │   │  queues    │  │  - leaderboard ZSETs
                          │  of truth)│   │  js/java/  │  │  - pub/sub for SSE
                          │           │   │  python +  │  │  - rate limiting  │
                          │           │   │  priority  │  │  - question cache │
                          └───────────┘   └─────┬─────┘  └──────────────────┘
                                                  │
                                                  ▼
                              ┌───────────────────────────────────────┐
                              │  Worker pool (N processes × M hosts)   │
                              │  configurable concurrency per process  │
                              │  same DockerSandbox as today            │
                              └───────────────┬─────────────────────────┘
                                                │ writes result + publishes event
                                                ▼
                                     MongoDB + Redis pub/sub
```

Key decision: **modular monolith + dedicated worker fleet**, not microservices. The existing `packages/shared` boundary already separates "things the API and workers both need" (models, protocol, config) from "things only the worker needs" (DockerSandbox, sandbox lifecycle). That boundary is the right shape for a Contest and Leaderboard module too, and nothing about 10k concurrent contest users requires splitting the Express app into separate services — it requires the Express app to be stateless and horizontally replicable, and it requires the worker fleet to scale independently of the API, which BullMQ already gives you for free once concurrency and multi-process/multi-host workers are configured.

## 5. Database Architecture

### Guiding rule applied throughout this section
MongoDB stores what must survive a restart and be queryable historically (submissions, contest results, final standings). Redis stores what changes every few hundred milliseconds during a contest and where staleness of a few seconds is acceptable (live rank, live leaderboard). We do **not** put the live leaderboard in Mongo, and we do **not** make Redis the permanent record of who won a contest.

### 5.1 Existing models — disposition

| Model | Disposition | Reasoning |
|---|---|---|
| `User` (`backend/models/User.js`) | **Extend** | Add contest-facing fields only; no breaking change to auth |
| `Question` (`packages/shared/models/Question.js`) | **Retain, add indexes** | Schema is fine for function-signature problems; contest linkage is a separate join collection, not a Question field, so one problem can be reused across contests |
| `Submission` (`packages/shared/models/Submission.js`) | **Retain, extend, index** | Add `contestId` (nullable — null means "practice submission"), add indexes. Do **not** fork into a separate `ContestSubmission` collection — see rationale below |
| Job/queue state | **Stays in BullMQ/Redis, not Mongo** | It's ephemeral by nature; persisting it to Mongo would duplicate what BullMQ already tracks and add a hot write path for no durability benefit |

**Why one `Submission` collection instead of a separate `ContestSubmission` collection:** the execution engine (`executionEngine.js`), the runner-generation code, and the worker dispatch logic are all submission-shape-agnostic today — they don't know or care whether a submission is "practice" or "contest." Forking the collection would mean forking that code too, which violates "preserve working architecture without a concrete technical reason." Instead, `Submission` gets an optional `contestId` field and a `contestProblemId` field; the judge pipeline is completely unaware of contests. Contest-specific behavior (scoring, penalty, leaderboard update) is a **post-processing consumer** of `submission.completed` events, not a fork of the pipeline itself.

### 5.2 New/extended models

#### `User` (extend)
```
Model: User
Purpose: Identity + contest-facing profile stats (existing auth fields unchanged)
New fields:
  rating              Number,  default: 1200,   // UNKNOWN — REQUIRES DECISION: exact rating algorithm (Elo-style vs Codeforces-style) is not specified anywhere in the repo or the task brief. Default flat rating is a placeholder; see ISSUE-118.
  contestsParticipated Number, default: 0
  highestRating       Number,  default: 1200
Indexes:
  { email: 1 } unique               — already exists
  { rating: -1 }                    — NEW: needed for a future "rating leaderboard" page; low write frequency (updates only at contest finalization), so this index is cheap
Write frequency: low (only at contest finalization)
Read frequency: low-medium (profile pages)
```

#### `Question` (retain, add indexes only)
```
No schema changes. Add indexes:
  { questionNum: 1 } unique   — already exists (declared in schema)
  { slug: 1 } unique          — already exists (declared in schema)
  { tags: 1 }                 — NEW: question.route.js list endpoint has no tag filter today, but Phase 10 frontend work (contest problem browsing) will need it; cheap multikey index on a rarely-written collection
Hot path today: question.route.js GET "/" does .find({}).select({...5 fields...}).sort({questionNum:1}).skip().limit() — this WORKS FINE on questionNum since it's already a unique (thus indexed) field being sorted ascending. No change needed here.
```

#### `Submission` (extend + index — the actual hot-path fix)
```
Model: Submission
New fields:
  contestId         ObjectId, ref: "Contest", default: null, index: true
  contestProblemId  ObjectId, ref: "ContestProblem", default: null
  submittedAtContestMs Number, default: null   // milliseconds since contest start, for penalty calc; computed at creation time so scoring never needs to re-derive it from timestamps + contest.startTime under load
New status values (see 5.3 below):
  status enum extends to: CREATED, QUEUED, RUNNING, COMPLETED   (was: PENDING, RUNNING, COMPLETED, with RUNNING unused)

Indexes (NEW — none of these exist today):
  { userId: 1, createdAt: -1 }                — fixes user.route.js /stats unbounded scan (still needs a query-shape fix too, see ISSUE-104)
  { userId: 1, questionId: 1 }                 — fixes submission.route.js GET /question/:questionId
  { contestId: 1, userId: 1, contestProblemId: 1, verdict: 1 }
                                                — the scoring hot path: "has this user already solved this contest problem, and how many prior wrong attempts count toward penalty"
  { contestId: 1, status: 1 }                  — contest-ops dashboards ("how many submissions still queued for this contest")
Expected write frequency during contest peak: see Section 8 quantified load model — dominant write path in the whole system during a contest.
Expected read frequency: dashboard/history reads are much lower frequency than writes during a contest; the live leaderboard read path does NOT touch this collection at all (see 5.4).
Hot fields: contestId, userId, contestProblemId, verdict, createdAt
Scalability concern: this collection's write rate scales linearly with contest submission rate. It is the single highest-write collection in the system during a contest and is the reason Section 8 sizes MongoDB write capacity around it specifically.
```

#### `Contest` (new)
```
Model: Contest
Purpose: Authoritative contest definition and lifecycle state. Backend is time-authoritative — see 5.3.
Fields:
  title              String, required
  slug               String, required, unique
  description        String
  startTime           Date, required
  endTime             Date, required
  registrationOpenTime Date, required   // when registration becomes possible
  status             String, enum: [DRAFT, SCHEDULED, REGISTRATION, RUNNING, ENDED, FINALIZED], default: DRAFT
  problems           [{ questionId: ObjectId ref Question, order: Number, points: Number, penaltyMinutes: Number }]
                      // penaltyMinutes: per-wrong-attempt penalty in minutes, ICPC-style; UNKNOWN — REQUIRES DECISION on default value, product hasn't specified scoring rules; ships with a configurable per-problem default (see ISSUE-119)
  createdBy          ObjectId, ref: User
Indexes:
  { slug: 1 } unique
  { status: 1, startTime: 1 }   — for the scheduler that flips DRAFT→SCHEDULED→REGISTRATION→RUNNING→ENDED (5.3)
TTL: none — contests are permanent historical records
Write frequency: very low (admin CRUD only, plus scheduled status transitions)
Read frequency: high right before/during a contest (every participant loads contest metadata once, cached — see 5.5)
```

#### `ContestParticipant` (new — registration)
```
Model: ContestParticipant
Purpose: Who registered for which contest; existence of this document IS the registration.
Fields:
  contestId    ObjectId, ref: Contest, required
  userId       ObjectId, ref: User, required
  registeredAt Date, default: now
Indexes:
  { contestId: 1, userId: 1 } unique   — the registration check ("has this user registered") and the duplicate-registration guard both use this compound unique index
  { userId: 1 }                        — "my contest history" queries
Write frequency: burst around registration open, near-zero during the contest itself
Read frequency: one check per submission ("is this user registered for this contest") — see ISSUE-120 for whether this is worth caching in Redis; at 10k participants a Mongo point-read on a unique compound index is already sub-millisecond, so this is explicitly NOT proposed as a Redis cache — adding one would be exactly the "add Redis for scalability" hand-waving the brief prohibits, for a query that's already cheap.
```

#### `ContestProblem` — **not a separate collection; UNKNOWN resolved as "embedded in Contest"**
The task brief lists "contest problems" as a candidate model. After inspecting `Question`, embedding `{ questionId, order, points, penaltyMinutes }` inside `Contest.problems[]` (above) is sufficient: contest problem lists are small (tens of entries), read together with the contest almost always, and never queried independently of their parent contest. A separate collection would require an extra join on every contest page load for no benefit. `contestProblemId` referenced elsewhere in this document means "the subdocument `_id` within `Contest.problems[]`" (Mongoose subdocuments get an `_id` by default).

#### `ContestLeaderboardSnapshot` (new — durability backstop, not the live leaderboard)
```
Model: ContestLeaderboardSnapshot
Purpose: Periodic durable snapshot of standings, and the FINAL authoritative result after finalization.
         Redis holds the live, fast-moving leaderboard (5.4 below); this collection exists so that
         (a) a Redis outage during a contest doesn't lose standings history, and
         (b) contest results are queryable historically the way Submissions are, without keeping the
             live Redis ZSET alive forever.
Fields:
  contestId   ObjectId, ref: Contest, required
  takenAt     Date, required
  isFinal     Boolean, default: false
  standings   [{ userId, rank, solvedCount, penalty, lastAcceptedAt }]
Indexes:
  { contestId: 1, isFinal: 1 }
  { contestId: 1, takenAt: -1 }
Write frequency: low — one write every N seconds per active contest (config, default 30s — see ISSUE-121), plus exactly one write at finalization
Read frequency: low (post-contest results pages, audit)
```

### 5.3 Submission lifecycle — target state machine

Current: `PENDING → COMPLETED` (with `RUNNING` defined but dead — Section 2).

Target:
```
CREATED   — Mongo document exists, not yet enqueued (this state is transient — it exists so an enqueue
             failure after the DB write leaves a diagnosable state instead of a silently-lost submission)
   ↓
QUEUED    — job accepted by BullMQ (this is the state that replaces today's overloaded "pending")
   ↓
RUNNING   — a worker has picked up the job and started sandbox execution (now actually set — see ISSUE-101)
   ↓
COMPLETED — terminal; verdict field holds the judge result (Accepted / Wrong Answer / ... — unchanged contract)
```
Why 4 states and not more: the brief's example included a 5th generic terminal step ("ACCEPTED/WRONG_ANSWER/…") — in this codebase that's already modeled correctly as the separate `verdict` field on `COMPLETED`, not as additional `status` values. No change needed there; conflating verdict into status would be revisiting a decision that already works.

We do **not** add a `FAILED` status distinct from `COMPLETED`. Today's `workerFactory.js` failure handler already routes exceptions to `status: "completed"` with `verdict: "Runtime Error"` or `"Time Limit Exceeded"` — that's the correct terminal modeling (a crashed judge run is still a completed judging attempt with a verdict), and the frontend's dead check for a `"failed"` status (Section 2) should be **deleted**, not implemented, to match reality (ISSUE-102).

### 5.4 Leaderboard — what's persisted, what's cached, what's computed live

**Persisted in MongoDB:** every individual `Submission` (already true today) and periodic `ContestLeaderboardSnapshot`s (5.2) plus the final snapshot at finalization.

**Live/authoritative-for-ranking data lives in Redis**, specifically as **Redis sorted sets**, one per contest:

```
Key:    contest:{contestId}:leaderboard
Type:   ZSET
Member: userId (string)
Score:  a single composite number encoding (solvedCount, penalty) so that ZREVRANGE gives correct rank
        order in one command, with no secondary sort needed:

        score = solvedCount * 10_000_000_000  −  penaltySeconds

        where penaltySeconds = Σ over solved problems of (time-to-first-accepted-solve in seconds
                                 + wrongAttempts * penaltyMinutes*60)
        (ICPC-style scoring — UNKNOWN, see Contest.problems.penaltyMinutes note in 5.2)

        Because solvedCount dominates the score by ~10 orders of magnitude, ZREVRANGE naturally ranks by
        "most problems solved" first and "least penalty time" second, without a compound sort in application code.
```

Supporting keys:
```
contest:{contestId}:user:{userId}:solved       SET of contestProblemId strings — O(1) "already solved?" check
contest:{contestId}:user:{userId}:wrongcount:{contestProblemId}  STRING (INCR'd) — wrong-attempt counter for penalty
contest:{contestId}:meta                       HASH — cached denormalized Contest doc (startTime, endTime, status) to avoid a Mongo round trip on every submission's penalty calc
```

Operations:
- **On a `submission.completed` event for a contest submission** (consumed by a small Contest-scoring worker, not the judge worker itself — see 5.5/Phase 5): if verdict is `Accepted` and the user hadn't already solved this problem (checked via the `:solved` SET, `SADD` returns 0 if already present ⇒ skip), compute penalty from `submittedAtContestMs` + wrong-count, `SADD` to `:solved`, then a single `ZADD` recomputing that user's score. If verdict is not `Accepted` and the problem isn't already solved, `INCR` the wrong-count key only — **no leaderboard write**, because a wrong submission before the first accepted one doesn't change rank until the user actually solves the problem. This is the concrete mechanism that satisfies "do NOT recalculate the entire leaderboard from MongoDB after every submission" — each event touches exactly one member's score via one `ZADD`, never a full recompute.
- **Rank lookup for one user:** `ZREVRANK contest:{contestId}:leaderboard {userId}` — O(log n).
- **Top-N:** `ZREVRANGE contest:{contestId}:leaderboard 0 N-1 WITHSCORES` — O(log n + N).
- **"Nearby users" (rank ± K):** `ZREVRANK` for the user's position, then `ZREVRANGE start-K start+K`.
- **Tie-breaking:** encoded directly in the composite score (see formula) — no separate tie-break pass needed. If two users have identical solvedCount and penalty (true tie), Redis ZSET breaks ties lexicographically by member (userId) — acceptable and deterministic; not spec'd otherwise anywhere.
- **Snapshotting:** a scheduled job (Phase 5) reads the full ZSET via `ZREVRANGE 0 -1 WITHSCORES` every 30s (configurable) while `Contest.status === RUNNING` and writes a `ContestLeaderboardSnapshot`. This is a bounded, infrequent operation — not a per-submission cost.
- **Finalization:** on `ENDED → FINALIZED` transition, take one last `ZREVRANGE 0 -1`, write it as `isFinal: true`, and this snapshot becomes the permanent historical record. The live ZSET key can then be expired (`EXPIRE` with a generous TTL, e.g. 7 days, rather than immediate deletion, as a safety window for reconciliation) — this is the one place a TTL is appropriate, and it's on a cache, not on source-of-truth data.

**What is explicitly NOT done:** the entire leaderboard is never written to MongoDB as a live-updating collection, and MongoDB is never queried to serve a leaderboard read during a running contest. This directly satisfies the brief's constraint.

### 5.5 Hot path analysis

**Normal practice (unchanged flow, today's actual bottleneck already identified in Section 3):**
```
POST /api/v1/submissions/:questionId → 1 Mongo write (Submission.create) → 1 Redis Queue.add
Worker: 2 sequential Mongo reads (getQuestionDetails: submission then question) → Docker exec → 1 Mongo write
```
No changes needed to this shape for practice mode. The `getQuestionDetails` double-read is a minor optimization opportunity (could be one `Promise.all`) but is **not** a hot-path problem at current or 10k-contest scale — it's 2 point-reads on indexed `_id` fields, sub-millisecond each. Not worth the churn; flagged as ISSUE-127 (P3) only for code cleanliness, not performance.

**Contest, 10,000 users — write hotspots:**
1. `Submission.create` — one write per submission, indexed on `contestId` for later scoring queries. This is the dominant Mongo write path; quantified in Section 8.
2. Redis `ZADD` on the leaderboard — one write per **accepted** submission that is a first-solve (not one per submission), because non-solving submissions only touch the per-user wrongcount key, not the shared ZSET. This is a deliberate design choice to keep the single most-contended key (the leaderboard ZSET) from being written on every submission — only on rank-changing events.
3. `contest:{contestId}:user:{userId}:wrongcount:*` — per-user keys, no cross-user contention, safe to write at full submission rate.

**Contest, 10,000 users — read hotspots:**
1. Leaderboard top-N reads — this is where "10,000 users" hits hardest if every client polls a leaderboard endpoint on a timer instead of receiving push updates. This is precisely why Phase 6/7 require the SSE event layer instead of polling — see Section 8's quantified comparison.
2. `Question`/`Contest` metadata reads — read-only, rarely-changing during a contest window. Cached in Redis (`contest:{contestId}:meta`, plus a short-TTL cache for the problem statement/testcases the API serves to the frontend) to avoid 10,000 concurrent clients each hitting Mongo for the same immutable document.

**Missing indexes identified (already covered in 5.2, restated here as the direct answer to "identify missing indexes"):** `Submission.userId`, `Submission.contestId` (+ compound with `contestProblemId`/`verdict`), `Contest.status+startTime`, `ContestParticipant.contestId+userId`. **N+1 pattern identified:** `user.route.js` `/stats` loads every submission and every question into memory and joins in application code (`questionsById` Map) — works today at low submission volume per user, but is exactly the kind of unbounded query the brief asks to flag; addressed as ISSUE-104 (bound the submission query with a date range/limit, or precompute stats incrementally rather than recomputing from full history on every dashboard load).

## 6. Backend Architecture

**Decision: modular monolith + dedicated worker fleet**, matching the brief's default and the existing `packages/shared` boundary. No microservice split is justified by anything found in the codebase or by the 10k-user target — a single well-indexed MongoDB primary/replica-set and a horizontally-scaled Express tier comfortably serve this load (quantified in Section 8), and splitting Auth/Contest/Leaderboard into separate deployable services would add network hops and operational surface with no scaling benefit the monolith doesn't already get from stateless horizontal replication.

### Modules

| Module | Responsibilities | Routes (existing/new) | DB models | Events emitted | Events consumed | Dependencies |
|---|---|---|---|---|---|---|
| Auth | Signup/signin/signout, JWT issuance | `/api/v1/auth/*` (existing) | User | — | — | none |
| User | Profile, stats | `/api/v1/user/*` (existing) | User, Submission | — | — | none |
| Problem | CRUD (admin), list/detail (public) | `/api/v1/questions/*` (existing), `/admin/questions/*` (existing) | Question | — | — | none |
| Submission | Practice submission intake + status read | `/api/v1/submissions/*` (existing, extended for contest awareness) | Submission | `submission.created`, `submission.queued`, `submission.running`, `submission.completed` (NEW — Phase 7) | — | Queue |
| Judge (workers) | Sandbox execution — **unchanged code**, extended config only (concurrency, retries) | none (not HTTP) | Submission, Question (read) | `submission.completed` | job payload | Queue, Docker |
| Contest | Lifecycle, registration, contest-scoped submission intake | `/api/v1/contests/*` (NEW) | Contest, ContestParticipant | `contest.started`, `contest.ended` (NEW) | `submission.completed` (to trigger scoring) | Submission, Scoring |
| Scoring | Consumes completed contest submissions, updates penalty/solved state, writes leaderboard ZSET | none (not HTTP — internal consumer) | Submission (read), Redis (write) | `leaderboard.updated`, `rank.updated` (NEW) | `submission.completed` | Contest, Redis |
| Leaderboard (read) | Serves top-N / user-rank / nearby reads from Redis | `/api/v1/contests/:id/leaderboard*` (NEW) | none (Redis only) | — | — | Redis |
| Events (SSE) | Fan-out of submission and leaderboard events to connected clients | `/api/v1/events/*` (NEW, SSE) | none | — | all of the above, via Redis pub/sub | Redis pub/sub |
| Admin | Question + user administration, **contest administration (NEW)** | `/admin/*` (existing + extended) | all | contest lifecycle events on manual override | — | Contest |

Failure modes to design for explicitly (per module):
- **Submission module:** enqueue failure after the Mongo write (Redis down) — submission stays `CREATED`, never reaches `QUEUED`; a reconciliation sweep (ISSUE-108) requeues `CREATED` submissions older than N seconds.
- **Judge/worker:** process crash mid-job — BullMQ's stalled-job detection (configured, not default today — ISSUE-109) requeues the job up to a bounded retry count; DockerSandbox's `finally` block already guarantees container cleanup on the happy and thrown-exception paths, but not on a hard process kill (`SIGKILL` to the worker itself) — orphaned containers from that case need a periodic sweep (`docker ps` filtered by the `sandbox-*` naming convention already in place — ISSUE-110).
- **Scoring consumer:** must be idempotent — the same `submission.completed` event delivered twice (at-least-once delivery, see Phase 7) must not double-count a solve. The `:solved` SET's `SADD` return value (0 if already a member) is the idempotency guard already designed into 5.4.
- **Events/SSE:** client disconnect/reconnect must not lose events — addressed via Redis Streams (not plain pub/sub) for the event bus so a reconnecting client can replay from a `Last-Event-ID`; see Phase 7.

## 7. API Architecture

Only new/changed endpoints are detailed; all existing endpoints (`/api/v1/auth/*`, `/api/v1/user/*`, `/api/v1/questions/*`, existing `/api/v1/submissions/*`, `/admin/questions/*`, `/admin/users`) keep their current contract unless noted.

### Contest

```
POST   /admin/contests
  Auth: admin
  Request: { title, slug, description, startTime, endTime, registrationOpenTime, problems: [{questionId, order, points, penaltyMinutes}] }
  DB ops: Contest.create
  Errors: 400 invalid schedule (endTime <= startTime), 409 slug collision

PUT    /admin/contests/:contestId
  Auth: admin
  Notes: disallow editing `problems` once status is RUNNING or later (integrity)

GET    /api/v1/contests
  Auth: none (public list) — but response fields differ if unauthenticated vs authenticated (registration status)
  DB ops: Contest.find({status: {$in:[SCHEDULED,REGISTRATION,RUNNING,ENDED,FINALIZED]}}).sort({startTime:-1})
  Cache: short TTL (e.g. 10s) in Redis — list is read constantly by the contests landing page and changes rarely

GET    /api/v1/contests/:slug
  Auth: none
  DB ops: Contest.findOne({slug}); if authenticated, also ContestParticipant.findOne({contestId,userId}) to include `registered: true/false`
  Cache: contest:{contestId}:meta HASH, populated on first read, invalidated on admin PUT

POST   /api/v1/contests/:contestId/register
  Auth: required
  Validation: contest.status is REGISTRATION or SCHEDULED-with-registrationOpenTime-passed; not already registered
  DB ops: ContestParticipant.create (relies on the unique compound index for the duplicate guard — catch E11000, return 409, not a race-prone pre-check)
  Rate limit: per-user, generous (registration isn't a judge-execution cost) — still limited to blunt scripted mass-registration abuse

GET    /api/v1/contests/:contestId/problems
  Auth: required + registered (or contest ENDED/FINALIZED — post-contest problems become publicly viewable, matching how question.route.js already hides hiddenTestCases from non-admins)
  DB ops: Contest.findById, populate problems.questionId, project out hiddenTestCases (same `.select({hiddenTestCases:0})` pattern already used in question.route.js)

POST   /api/v1/contests/:contestId/submissions/:contestProblemId
  Auth: required + registered + contest.status === RUNNING (backend clock, not client — see 5.3/Phase 5 for the authoritative-time mechanism)
  Request: { language, code }  — same shape as today's practice submission
  DB ops: Submission.create({..., contestId, contestProblemId, submittedAtContestMs: Date.now() - contest.startTime})
  Queue: same language-routed BullMQ queues as today, same job shape plus contestId passthrough
  Rate limit: per-user, per-contest — tighter than practice submissions (this is the endpoint a malicious/careless client could hammer during a live contest)
  Events emitted: submission.created

GET    /api/v1/contests/:contestId/leaderboard
  Auth: none (public) or required, depending on contest visibility settings — UNKNOWN, default to public since this is a LeetCode-contest-style product; flagged for product decision (ISSUE-122)
  DB ops: NONE during a running contest — served entirely from Redis ZREVRANGE (5.4)
  Cache: this endpoint IS the cache; no additional layer needed
  Fallback: if contest.status is ENDED/FINALIZED, serve from ContestLeaderboardSnapshot{isFinal:true} instead of Redis (Redis key may have expired per the 7-day TTL in 5.4)

GET    /api/v1/contests/:contestId/leaderboard/me
  Auth: required
  DB ops: none — ZREVRANK + a small ZREVRANGE window around the user's rank

GET    /api/v1/events?contestId=...   (SSE)
  Auth: required
  Behavior: see Phase 7 — subscribes to Redis Stream(s) scoped to the user's own submissions plus the contest's leaderboard-update stream if `contestId` is present
```

## 8. Submission Lifecycle (target)

Already specified in 5.3. Additive note for the API layer: the existing practice endpoint (`POST /api/v1/submissions/:questionId`) is **unchanged in contract** — it still returns `{ submissionId, status: "processing" }` immediately (already non-blocking today, confirmed by reading `submission.route.js`: the route awaits `Submission.create` and `targetQueue.add`, both fast operations, then returns — it does **not** await judge execution). This is one of the things already correct in the current implementation and is explicitly preserved, not redesigned.

## 9. Queue Architecture

Current: `Queue.add("execute", {submissionId})` with **zero options** (confirmed in `backend/routes/submission.route.js`). Target adds real job configuration without changing the queue topology (still one BullMQ queue per language — that topology is fine and matches "route by language" cleanly):

```js
await targetQueue.add("execute", { submissionId, contestId: contestId ?? null }, {
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: { age: 3600, count: 1000 },   // keep 1hr / last 1000 for debugging, then evict — fixes unbounded Redis growth
  removeOnFail: { age: 86400 },                    // keep failures 24hr for triage
  priority: contestId ? 1 : 5,                     // lower number = higher priority in BullMQ; contest submissions preempt practice submissions during shared load
});
```

- **Retries:** `attempts: 3` with exponential backoff — a transient Docker daemon hiccup or a momentary Mongo blip no longer permanently strands a submission at `RUNNING`. **Idempotency for retries:** the judge pipeline is naturally idempotent per attempt (each attempt gets its own sandbox directory keyed by `${language}-${job.id}-${job.attemptsMade}` — a small change from today's `${language}-${job.id}` to avoid a retried job colliding with cleanup-in-progress from a prior failed attempt; ISSUE-111) and `updateSubmission` is a last-write-wins overwrite of the same document, so a retry that eventually succeeds simply overwrites a possibly-`Runtime Error`-flagged intermediate state with the correct verdict.
- **Duplicate submissions (client-side):** addressed at the API layer, not the queue — `POST` handler generates a request-scoped idempotency key (client-supplied header or a hash of `userId+questionId+code+minute-bucket`) and short-TTL-caches it in Redis to reject exact-duplicate resubmits within a short window (ISSUE-112). This is deliberately **not** solved by BullMQ job IDs, because BullMQ job IDs are per-queue (already a documented gotcha in this codebase — see the ISSUE-015 sandbox-collision fix in `ISSUES.md`) and reusing that mechanism for submission dedup would be piggybacking two unrelated concerns onto the same ID space.
- **Dead-letter handling:** after `attempts` are exhausted, BullMQ marks the job `failed`; the existing `worker.on("failed", ...)` handler in `workerFactory.js` already writes a terminal `Runtime Error`/`Time Limit Exceeded` verdict — this is correct dead-letter behavior for a judge (a submission that can't be judged after retries IS a runtime error from the user's point of view) and needs no new mechanism, just the `attempts` option to actually get retries first.
- **Timeout handling:** unchanged — already enforced inside `executionEngine.js` (45s overall, 2s per test case, 25s Java compile) independent of BullMQ's own job semantics. No overlap/conflict between the two layers.
- **Cancellation:** **UNKNOWN — REQUIRES DECISION.** Nothing in the current codebase supports cancelling an in-flight submission, and the brief doesn't specify whether contest UX needs it (e.g., "resubmit" implicitly cancelling a stale run). If required, BullMQ supports `job.remove()` pre-execution and the DockerSandbox's `destroy()` can be called externally, but wiring a cancel button through to a specific running container is new plumbing not scoped by anything currently in the repo. Flagged as ISSUE-123, explicitly out of the P0/P1 critical path.
- **Priority:** contest submissions (`priority: 1`) preempt practice submissions (`priority: 5`) when both compete for the same finite worker pool, which matters directly at 10k-contest scale if practice traffic continues during a live contest.
- **Backpressure:** BullMQ queue depth is monitored (Phase 10 metrics: `queue depth` per language queue) and the Submission API can **reject new practice submissions with a 429** if a language queue's depth exceeds a configured threshold while a contest is RUNNING — protecting contest submissions' latency from being starved by unrelated practice load, without needing a second queue per language. (Two per-language queues — practice vs contest — was considered and rejected: it doubles worker-subscription complexity for a distinction `priority` already expresses at the job level.)

## 10. Worker Architecture

**Preserve entirely:** `DockerSandbox`, `createSandbox`/`cleanupSandbox` (path-traversal-checked, language+jobId-namespaced — this already correctly solves the cross-language collision problem per ISSUE-015 in `ISSUES.md`), `executionEngine.js`'s verdict/comparison logic, the BLSP protocol. None of this needs to change for 10k-user scale; it needs to be **run more times in parallel**, which is a configuration and process-topology problem, not a logic problem.

### What changes

```
                    BullMQ (per-language queue, Redis)
                              │
        ┌─────────────────────┼─────────────────────┐
        │ Worker host 1        │ Worker host 2         │ Worker host N
        │ (env: WORKER_        │                       │
        │  CONCURRENCY=8)      │                       │
        │  js worker proc      │  js worker proc       │  ...
        │  java worker proc    │  java worker proc     │
        │  python worker proc  │  python worker proc   │
        │  (each proc: N       │                       │
        │   concurrent Docker  │                       │
        │   containers)        │                       │
        └───────────────────────┴───────────────────────┘
```

1. **Configurable concurrency (ISSUE-113, P0):** `new Worker(queueName, processor, { connection, concurrency: Number(process.env.WORKER_CONCURRENCY) || 1 })` in `workers/common/workerFactory.js`. Preserves today's behavior exactly when unset (default 1), which is important — this is a config addition, not a behavior change for existing deployments.
2. **Per-host admission control (ISSUE-114, P0):** concurrency must be bounded by actual host capacity — each container already claims `--cpus=1` and `--memory=256m`. A host with 16 cores should run `WORKER_CONCURRENCY` around 12–14 per language process (leaving headroom for the Node event loop, Docker daemon, and OS), not naively "16". This is a deployment-config decision made per host class, not a code change; documented in the worker's README rather than hardcoded, because it's infrastructure-dependent.
3. **Horizontal scaling across hosts:** already free — BullMQ workers on the same queue name are already safe to run on multiple hosts today (nothing in the current code assumes single-process; the sandbox collision fix already namespaces by `${language}-${jobId}`, which is unique per job even across hosts). This just needs to be **exercised and documented**, plus the per-host temp directory (`workers/common/temp`) confirmed to be genuinely host-local (it is — plain `fs.mkdirSync`, no shared filesystem assumption).
4. **Stalled-job recovery (ISSUE-109, P0):** configure BullMQ's `lockDuration`/`stalledInterval` so a worker process that dies mid-execution (not just a thrown exception, but a hard process kill) has its job automatically requeued rather than stuck at `RUNNING` forever. BullMQ's stalled-job detection exists specifically for this and is currently entirely unconfigured (relying on defaults, which do eventually catch a stalled job, but the `lockDuration` default may be shorter or longer than this workload's 45s worst-case submission deadline — must be tuned to `> OVERALL_SUBMISSION_TIMEOUT_MS`, or a legitimately-still-running 44-second submission gets falsely requeued and double-executed).
5. **Orphaned container sweep (ISSUE-110, P1):** a scheduled cron-style task per worker host runs `docker ps --filter name=sandbox- --filter status=running` and force-removes containers older than the max submission deadline plus a safety margin — a backstop for the hard-kill case `DockerSandbox.destroy()`'s `finally` block can't reach.
6. **Graceful shutdown (ISSUE-115, P1):** `SIGTERM` handler in each `worker.js` entrypoint that stops accepting new jobs (`worker.close()`, which BullMQ supports) and lets in-flight jobs finish before process exit — currently absent; needed for zero-downtime worker deploys during a live contest.

### Explicit failure-mode table (as requested by the brief)

| Event | Current behavior | Target behavior |
|---|---|---|
| Worker process crashes | Job eventually detected as stalled by BullMQ defaults (untuned); submission may sit at `pending`/`running` indefinitely if timing doesn't line up | Tuned stalled detection (item 4) requeues within a bounded, known window; retried via `attempts` (Section 9) |
| Container crashes (not worker) | `sandbox.destroy()` in the `finally` block force-removes it; execution engine surfaces `Runtime Error` from `crashedTestCaseId` handling — **already correct** | No change needed |
| Docker daemon unavailable | `DockerSandbox.start()` rejects; propagates as a job exception; `workerFactory`'s `failed` handler marks `Runtime Error` — **already correct**, though it mislabels an infra failure as a code-runtime failure from the user's perspective | Add a distinct internal alert/metric when the failure originates from `start()` specifically (Docker daemon down) vs from inside `runInteractiveBatch` (user code crashed) — cosmetic/observability improvement (ISSUE-124, P2), not a correctness fix, since the user-facing verdict handling already degrades safely |
| Job times out (overall 45s) | Already handled — `Time Limit Exceeded` verdict, sandbox destroyed in `finally` | No change |
| Compiler hangs | Already handled — 25s compile watchdog, `sandbox.exec`'s own `setTimeout`+`killAllExecProcesses` | No change |
| Program hangs | Already handled — 2s per-test watchdog inside `runInteractiveBatch` | No change |
| Database (MongoDB) unavailable | `getQuestionDetails`/`updateSubmission` throw; propagates to `worker.on("failed")`, which **itself calls `updateSubmission`** — a Mongo-down failure can't actually be recorded by the failure handler either, since it depends on the same downed dependency; job simply fails and (once retries are configured) retries per Section 9's backoff | Same mechanism, now retryable — Mongo blips self-heal via BullMQ retry rather than permanently stranding the submission |
| Queue (Redis) unavailable | Submission API's `Queue.add` throws; caught by the route's try/catch, returns 500 to client, but the `Submission.create` write **already happened** — submission exists in Mongo as `CREATED`/`pending` with no job ever enqueued | Reconciliation sweep (ISSUE-108, mentioned in Section 6) — a scheduled task requeues any `Submission` in `CREATED` status older than a short grace period, self-healing the gap between the Mongo write and the enqueue |
| Result update fails (Mongo write after judge run) | `updateSubmission` throws inside the `try` block of `executeSubmission`; propagates up, hits `worker.on("failed")`, which tries the **same** `updateSubmission` call again and also fails; job is retried per queue config (once configured) — sandbox is still cleaned up correctly via `finally` regardless | Same, now retryable; worth noting the `finally` block's cleanup is unconditional and correct today regardless of where in the `try` an error originates — no change needed there |

## 11. Docker/Judge Security

No changes to the security posture — it's already correctly designed (`--network none`, `--cap-drop ALL`, `--security-opt no-new-privileges`, `--read-only`, `--user 1000:1000`, memory/CPU/pids caps, Java's additional `SecurityManager` defense-in-depth layer). The one addition scoped by this roadmap:

- **Per-host concurrent-container ceiling (ISSUE-114, restated from Worker Architecture):** raising BullMQ concurrency without a host-level cap on total simultaneous `docker run` invocations could let a burst of jobs oversubscribe a host's real CPU/memory even though each container individually declares `--cpus=1 --memory=256m` (cgroup limits cap usage per-container, not aggregate host admission). `WORKER_CONCURRENCY` **is** that admission control today (each worker process only pulls as many jobs as its concurrency allows), so this is already solved by item 1 in Section 10 as long as it's set conservatively per host — flagged here as a reminder that this is a security/stability property, not just a throughput one.
- No change to network access, filesystem access, or the fork-bomb/CPU/memory exhaustion protections — `--pids-limit=64`, `--cpus=1`, `--memory=256m` already directly cover fork bombs, CPU exhaustion, and memory exhaustion respectively, and were verified in the README/ISSUES.md history (ISSUE-008) with real Docker tests.
- Oversized input/output: already bounded (`MAX_OUTPUT_BUFFER_BYTES = 5 * 1024 * 1024` in `executionEngine.js`, applied to both `exec` and `runInteractiveBatch`). No change.
- Malicious source code: covered by the container boundary; the Java `SecurityManager` layer is explicitly documented in the README as defense-in-depth, not the primary boundary — this roadmap doesn't touch it.

## 12. Contest Architecture

### Lifecycle and backend time authority

```
DRAFT → SCHEDULED → REGISTRATION → RUNNING → ENDED → FINALIZED
```
Transitions are driven by a scheduled backend process (ISSUE-125, P0) comparing `Date.now()` against `Contest.registrationOpenTime`/`startTime`/`endTime` — **never** by a client-supplied timestamp. Every contest-scoped write endpoint (registration, contest submission) independently re-validates `contest.status` and the current server time against `contest.startTime`/`endTime` at request time, rather than trusting a cached/earlier-fetched status — this is what "the backend must be authoritative" means concretely: a request arriving one second after `endTime` is rejected even if the client's local countdown timer said there were still 3 seconds left.

- `DRAFT → SCHEDULED`: manual admin action (publishing a contest) — not time-driven.
- `SCHEDULED → REGISTRATION`: automatic when `now >= registrationOpenTime`.
- `REGISTRATION → RUNNING`: automatic when `now >= startTime`. On this transition, the scheduler also initializes the Redis leaderboard structures (5.4) for all registered participants (pre-seeding scores at 0 so early leaderboard reads before anyone's solved anything return a complete, correctly-ranked-by-registration-time-tiebreak list rather than an empty set — UNKNOWN whether pre-seeding is wanted vs. a truly empty board; default to pre-seeding since it's more predictable, flagged ISSUE-126).
- `RUNNING → ENDED`: automatic when `now >= endTime`. Submissions after this point are rejected at the API layer (Section 7).
- `ENDED → FINALIZED`: **not automatic** — deliberately a manual/reviewed admin action, because finalization is what triggers the permanent `ContestLeaderboardSnapshot{isFinal:true}` and (per Section 5.1's rating field) any rating recalculation; an admin should be able to review standings before locking them in, especially since disqualifications/manual corrections most plausibly happen in the `ENDED`-but-not-yet-`FINALIZED` window. This is a product decision inferred from standard contest-platform practice, not from anything in the repo — flagged as a default, not a hard requirement.

### Scoring

ICPC-style (solved count primary, penalty time tiebreak) — **decided in Phase 6 review** (`PHASE_6_SCORING_ENGINE.md`). MongoDB authoritative scoring uses ACM/ICPC penalty semantics; `Contest.problems[].points` is retained but not used for Phase 6 ranking. Phase 7 Redis ZSET composite score formula remains derived from the same solved-count + penalty sort key.

## 13. Redis Architecture (consolidated reference)

| Key pattern | Type | Purpose | Written by | Read by | TTL |
|---|---|---|---|---|---|
| `js-queue`/`java-queue`/`python-queue` (BullMQ-managed) | list/hash/zset (BullMQ internals) | job queue | API (add), Worker (consume) | Worker | per `removeOnComplete`/`removeOnFail` (Section 9) |
| `contest:{id}:leaderboard` | ZSET | live ranking | Scoring consumer | Leaderboard API | 7d after contest ENDED (5.4) |
| `contest:{id}:user:{uid}:solved` | SET | idempotent solved-tracking | Scoring consumer | Scoring consumer | same as leaderboard key |
| `contest:{id}:user:{uid}:wrongcount:{cpid}` | STRING (int) | penalty tracking | Scoring consumer | Scoring consumer | same as leaderboard key |
| `contest:{id}:meta` | HASH | denormalized contest metadata cache | API (populate on read, invalidate on admin write) | API | short TTL + explicit invalidation |
| `idempotency:submission:{hash}` | STRING | duplicate-submission guard (Section 9) | Submission API | Submission API | 60s |
| SSE event stream(s) (Phase 7) | Redis Stream | event fan-out for reconnect/replay | API instances (producers), Contest/Scoring consumers (producers) | API instances (SSE consumers) | capped length (`XTRIM`), not time-based |
| rate-limit counters (Phase 9) | STRING (INCR + EXPIRE) | per-user/per-IP throttling | rate-limit middleware | rate-limit middleware | sliding window (e.g. 60s) |

Consistency model: Redis is **cache/derived-state** everywhere in this table except the queue itself (which is BullMQ's authoritative in-flight job state, already the existing design) and the SSE stream (which is a transient delivery mechanism, not a record of truth — the underlying `submission.completed`/`leaderboard.updated` facts are always independently derivable from MongoDB). If Redis is flushed entirely during a running contest, the system's designed recovery path is: leaderboard ZSETs are rebuildable from the `Submission` collection (query all `contestId`-matching, `verdict: Accepted` submissions, replay in `createdAt` order) — this rebuild procedure is specified as an operational runbook (ISSUE-121) rather than an automatic mechanism, since a full Redis flush mid-contest is a rare disaster scenario, not a steady-state failure mode to engineer away silently.

## 14. Real-Time Event Architecture

**Decision: Server-Sent Events (SSE), not WebSocket, not polling.**

Reasoning: every real-time need identified (submission status transitions, leaderboard updates, contest start/end) is **server-to-client only** — the client never needs to push data back over the same channel (submissions are already regular POST requests). SSE gives unidirectional push over plain HTTP, works through standard load balancers/proxies without special upgrade handling, and critically — the browser's native `EventSource` API has **built-in reconnect with `Last-Event-ID`**, which maps directly onto the Redis Streams `XREAD`-from-ID replay mechanism in Section 13, giving "missed events" recovery close to for free. WebSocket would only be justified if bidirectional interactivity were needed (it isn't, based on everything in this repo and brief) and would add connection-upgrade/sticky-session complexity this system doesn't need to take on. Plain polling (extending today's 1000ms-per-submission pattern) is explicitly rejected for the leaderboard specifically because of the load math in Section 15 — polling scales read load linearly with connected users on a fixed interval, push scales with actual state-change rate, which is far lower.

### Events

| Event | Producer | Payload (indicative) | Consumers |
|---|---|---|---|
| `submission.created` | Submission API route, on enqueue | `{submissionId, questionId, contestId?}` | the submitting user's own SSE stream only |
| `submission.queued` | (same as created — combined in practice, since enqueue is synchronous with creation today; kept as a distinct semantic event for future-proofing if queueing is ever decoupled) | `{submissionId}` | submitting user |
| `submission.running` | Worker, at the point `RUNNING` status is set (ISSUE-101) | `{submissionId}` | submitting user |
| `submission.completed` | Worker, after `updateSubmission` | `{submissionId, verdict, status}` | submitting user; **also** the Scoring consumer (Section 6) if `contestId` is set — this is an internal consumer, not delivered over SSE to other users |
| `contest.started` | Contest lifecycle scheduler (12) | `{contestId}` | all connected clients subscribed to that contest |
| `contest.ended` | Contest lifecycle scheduler | `{contestId}` | all connected clients subscribed to that contest |
| `leaderboard.updated` | Scoring consumer, after a `ZADD` that changes a user's score | `{contestId, userId, newRank?}` — payload intentionally light; clients re-fetch top-N via the REST leaderboard endpoint rather than receiving the full leaderboard body over SSE, keeping the event itself cheap to fan out to thousands of subscribers | all connected clients subscribed to that contest's leaderboard |
| `rank.updated` | derived from `leaderboard.updated` — same producer; separated conceptually because a client watching only their own rank (not the full board) can subscribe to a narrower stream | `{contestId, userId, rank}` | the specific user whose rank changed (delivered to their own stream), not broadcast |

### Delivery mechanics

- **Transport:** one SSE connection per client at `GET /api/v1/events?contestId=...`, authenticated via the existing cookie (SSE requests carry cookies like any other GET).
- **Producer → transport bridge:** all events are published to Redis Streams (Section 13), **not** plain Redis pub/sub, specifically because pub/sub has no replay/history — a client that reconnects mid-contest after a network blip would silently miss every event published during the gap. Redis Streams (`XADD`, consumed via `XREAD ... $LASTID`) let a reconnecting `EventSource` (which automatically sends `Last-Event-ID`) resume exactly where it left off.
- **Per-contest stream, not global:** `stream:contest:{contestId}:events` — each API instance holding open SSE connections for that contest runs one `XREAD` loop and fans out to its locally-held connections; this bounds per-instance Redis read load to "number of distinct contests this instance has active viewers for," not "number of connections."
- **Ordering:** guaranteed per-stream by Redis Streams' monotonic IDs — no additional ordering logic needed.
- **Duplicate events:** the Scoring consumer's idempotent `SADD`-guarded update (5.4) means a duplicate `submission.completed` delivery produces at most one real leaderboard change; the SSE fan-out itself is at-least-once, and clients are expected to treat `leaderboard.updated` as a cue to re-fetch rather than as the authoritative delta, which makes duplicate delivery harmless by construction (this is why the payload is intentionally light — see table above).
- **Scaling connections:** stateless API instances behind a load balancer; each instance holds a subset of the total SSE connections. At 10,000 concurrent contest viewers, if evenly distributed across (per Section 15's sizing) roughly 4–6 API instances, that's on the order of 2,000 long-lived connections per instance — well within a single Node process's socket capacity, but does require the LB to support long-lived HTTP connections without an aggressive idle timeout (an infra config note, ISSUE-128).

## 15. Scalability Model (quantified)

**Stated assumptions (explicitly marked, since none of this is specified in the repo or brief and must not be silently invented):**
- Contest duration: 90 minutes (a common competitive-programming contest length; not specified by the brief — treat as a placeholder for sizing math, adjust if the real product differs).
- 10,000 registered participants, with realistic attendance/activity meaning not all 10,000 submit simultaneously at every instant, but submission volume is front-loaded near contest start and again near contest end (typical contest submission distribution).
- Average of 5 submissions per user across the contest (mix of wrong attempts and an eventual accept, across several problems) ⇒ 50,000 total submissions over 90 minutes ⇒ **~9.3 submissions/sec average**.
- Peak burst factor of ~6x average during the first 10 minutes and last 10 minutes (both are documented patterns in competitive programming: everyone reads problem 1 and submits quickly, and there's a last-minute rush before the deadline) ⇒ **peak ≈ 55–60 submissions/sec**.
- Average judge execution time per submission: 2–5 seconds (well under the 45s worst-case ceiling; most accepted/wrong-answer verdicts resolve on the first few test cases or all test cases quickly for typical function-signature problems) — call it **3.5s average** for sizing.

**Derived worker capacity requirement:** to sustain 60 submissions/sec at 3.5s average execution time, the system needs roughly `60 * 3.5 ≈ 210` concurrent Docker sandbox executions at peak (Little's Law: concurrent executions ≈ arrival rate × service time). Each container reserves `--cpus=1`; budgeting conservatively at ~12 concurrent containers per 16-core worker host (leaving headroom per item 2 of Section 10) means **≈ 18 worker hosts at peak**, scaling down between bursts. This is the single most important capacity number in this document — everything else (queue throughput, Mongo write rate, Redis ops) is comfortably below what commodity infrastructure handles, but **worker fleet size is the real cost/scaling driver** for a code-judging platform, which matches the intuition that judging, not the API, is the expensive part.

| Layer | Estimated load at peak | Comfortably handled by |
|---|---|---|
| API requests/sec | Submissions (≈60/s) + leaderboard reads (bounded — see below, not per-client polling) + registration/auth (negligible during RUNNING) ≈ **low hundreds/sec total** | A handful of stateless Express instances behind a load balancer; no architectural stretch |
| Submissions/sec | ≈60/s peak, ≈9/s average | BullMQ/Redis trivially sustains this; the constraint is judge capacity (worker fleet), not queue throughput |
| Queue throughput | Same as submissions/sec — BullMQ on Redis handles orders of magnitude more than this | Non-issue at this scale |
| Worker capacity | ≈210 concurrent Docker executions at peak | ≈18 worker hosts at the conservative 12-containers/host budget (Section 10) — the actual scaling knob |
| MongoDB writes/sec | ≈60/s `Submission.create` + ≈60/s `Submission` result updates (2 writes per submission across its lifecycle) ≈ **~120 writes/sec peak** | A single well-indexed MongoDB primary handles this without difficulty; a replica set is still recommended for availability (Phase 8 note below), not because single-primary write throughput is the bottleneck |
| Redis operations/sec | Queue ops (~120/s) + leaderboard `ZADD`s (only on rank-changing accepts — a fraction of 60/s, call it ≤20/s) + SSE stream `XADD`s (bounded by actual state-change events, similarly low) | Trivial for Redis; Redis's real constraint here is memory (Streams/ZSETs sized for 10k contest participants, negligible in absolute terms), not ops/sec |
| SSE/WebSocket connections | Up to 10,000 concurrent long-lived connections | Distributed across ~4–6 stateless API instances (Section 14) — a connection-count/memory planning exercise, not a CPU-bound scaling problem |
| Leaderboard reads | **This is the number polling would have made dangerous.** If every one of 10,000 clients polled a leaderboard endpoint every 2 seconds, that's 5,000 reads/sec against a system whose real event rate (leaderboard-changing accepts) is ≤20/sec — a 250x amplification for no benefit. With SSE push instead, leaderboard reads only happen on: initial page load (≤10,000 one-time reads, spread over however long the contest page takes to fill up with viewers, not a spike) and on receipt of a `leaderboard.updated` event (bounded by the ≤20/sec real event rate, not the viewer count) | Redis `ZREVRANGE` calls at low tens/sec — this comparison is the concrete justification for choosing push over polling, not a hand-wave |

**Bottleneck identified and how each is designed for:** the worker fleet (Docker execution capacity) is the true scaling bottleneck for this product, by a wide margin over the API/DB/Redis/real-time layers, which all have comfortable headroom at this load. This is why Phase 4 (worker infrastructure) and Phase 3 (queue configuration enabling that scaling) are sequenced before the contest/leaderboard/real-time work in this roadmap's implementation order — the contest engine is worthless at 10k-user scale if the judge can't keep up with 60 submissions/sec, regardless of how good the leaderboard is.

### API/DB/Redis/Judge/Real-time scaling summary

- **API:** stateless Express, horizontal replication behind a load balancer — no session affinity required except for the SSE connections (Section 14), which need long-idle-timeout support at the LB, not sticky sessions (any instance can serve any user since state lives in Redis/Mongo, not in-process).
- **Database:** add the indexes in Section 5; run MongoDB as a replica set (not sharded — write volume in the table above doesn't approach sharding territory) for availability, with reads for non-critical paths (e.g. historical stats) optionally routed to a secondary to keep the primary's write path (submissions) uncontended. Pagination already exists on the questions list (`.skip().limit()`, capped at 100 — Section 3 item, already fixed per ISSUE-011 in `ISSUES.md`); apply the same capped-limit pattern to any new admin-facing contest/participant list endpoints (ISSUE-129).
- **Redis:** single Redis instance is sufficient at this load per the table above; a managed Redis with persistence (already using `appendonly yes` per `docker-compose.yml`) and a replica for failover is a reasonable production baseline, not a requirement driven by this specific load.
- **Queue:** worker scaling per Section 10; backpressure via the 429-on-deep-queue mechanism in Section 9; dead-letter via existing `failed` handling once retries are configured.
- **Judge:** concurrency + host budgeting per Section 10; this is where actual infrastructure spend scales with contest size.
- **Real-time:** SSE + Redis Streams per Section 14; connection count is a memory/instance-count planning exercise, not an architectural risk at 10k.

## 16. Rate Limiting

None exists today (Section 3). Target, applied via middleware (new `backend/middleware/rateLimit.js`, using the Redis rate-limit-counter pattern in Section 13):

| Endpoint | Limit (indicative — tune in staging) | Rationale |
|---|---|---|
| `POST /api/v1/auth/signin` | 10/min per IP + per attempted email | Brute-force mitigation — currently entirely absent, a genuine security gap independent of the contest work |
| `POST /api/v1/auth/signup` | 5/hour per IP | Abuse/spam-account mitigation |
| `POST /api/v1/submissions/:questionId` (practice) | e.g. 20/min per user | Prevents accidental or scripted hammering of judge capacity outside contests |
| `POST /api/v1/contests/:id/submissions/:cpid` (contest) | e.g. 10/min per user per contest — tighter than practice, since this is the highest-value-per-request endpoint during peak load | Protects fair judge-capacity allocation across 10,000 simultaneous contestants; also directly limits how much any single user can contribute to the "peak burst" load modeled in Section 15 |
| `POST /api/v1/contests/:id/register` | e.g. 5/min per user | Blunt scripted-registration abuse without meaningfully affecting legitimate use |

Rate limiting is deliberately **not** applied to `GET` reads (question list/detail, leaderboard) beyond what caching already absorbs (Section 15's leaderboard-read math) — those are already cheap and read-only.

## 17. Security (consolidated, beyond judge sandboxing already covered in Section 11)

- Auth rate limiting (Section 16) closes the brute-force gap identified in Section 3/README's own stated limitation ("Authentication routes do not implement rate limiting or account lockout").
- JWT lifetime (30 days, currently) is unchanged by this roadmap — shortening it or adding revocation is a separate product/security decision not scoped by the 10k-contest-user goal; flagged as out-of-scope (ISSUE-130, P3) rather than silently bundled in.
- Contest submission authorization is layered: `authMiddleware` (existing) → registered-for-contest check → contest-is-RUNNING check (server clock) — all three must pass, each independently re-validated per request per Section 12, not cached client-side.
- Admin contest management reuses the existing `authMiddleware` + `adminMiddleware` pattern (`backend/middleware.js`) — no new admin-auth mechanism needed.
- Secrets exposure: unchanged from today — `.env`-based configuration (already the pattern for `MONGODB_URI`, `REDIS_HOST/PORT`, `JWT_SECRET`); no new secret material is introduced by contests/leaderboard/SSE.

## 18. Observability

**Current state:** `console.log`/`console.error` only, no metrics, no health checks (Section 3).

### Logging (target)
Structured (JSON) logs for: API requests (method, path, status, latency, userId if authenticated), submission lifecycle transitions (submissionId, status change, timestamp), job lifecycle (queued/started/completed/failed, queue name, attempt number), container lifecycle (start/exec/destroy, jobId, duration), contest events (registration, contest state transitions), leaderboard updates (contestId, userId, new score — not full board, to keep log volume bounded). Implementation: a small structured-logging wrapper (e.g. pino, given it's already a common, low-overhead choice for Node/Express — not currently a dependency, so this is a new addition) replacing raw `console.*` calls incrementally, starting with the highest-value paths (submission/job lifecycle) rather than a big-bang rewrite (ISSUE-131, P2).

### Metrics (target, minimum set from the brief, mapped to this system's actual components)
```
submission_rate           — counter, labeled by language and practice/contest
queue_depth                — gauge per BullMQ queue (js/java/python), polled via BullMQ's getJobCounts()
job_wait_time               — histogram: enqueue → RUNNING
job_execution_time          — histogram: RUNNING → COMPLETED (already partially available as submission.totalRuntime/maxRuntime, but that's judge-internal runtime, not wall-clock job time — both are useful and distinct)
worker_utilization          — gauge: active containers / WORKER_CONCURRENCY, per host
judge_success_rate          — counter: COMPLETED with a non-crash verdict / total COMPLETED
judge_failure_rate          — counter: Runtime Error / Time Limit Exceeded verdicts specifically attributable to infra failure (Docker/Mongo unavailability) vs. genuine user-code failure — requires the ISSUE-124 distinction from Section 10 to be meaningful
api_latency                 — histogram per route
database_latency            — histogram per Mongo operation type
redis_latency                — histogram per Redis operation type
leaderboard_update_latency  — histogram: submission.completed received → ZADD complete
sse_connections              — gauge, per API instance and total
```
Exposed via a `/metrics` endpoint in Prometheus text format (a natural fit given the metric shapes above) — a new, small addition (ISSUE-132, P1), not present today.

### Health checks (target)
```
GET /health/live     — process is up (no dependency checks) — for orchestrator liveness probes
GET /health/ready     — checks Mongo connection state, Redis connection state, and (for worker processes)
                        Docker daemon reachability (`docker info` or equivalent) — for orchestrator readiness/traffic-admission
```
Currently absent entirely (ISSUE-133, P1) — needed before any horizontal-scaling deployment (Section 15) can be safely automated, since a load balancer/orchestrator needs a real signal to stop routing to an instance with a broken Mongo/Redis connection.

## 19. Failure Recovery (cross-reference)

Already specified per-component in Section 10's failure-mode table and Section 9's queue-retry design. Summarized end-to-end:

| Scenario | Recovery mechanism | Section |
|---|---|---|
| Worker crash | Tuned BullMQ stalled-job detection + `attempts` retry | 10, 9 |
| Container crash | Existing `finally`-block cleanup + engine's crash handling — already correct | 10, 11 |
| Docker daemon down | Job exception → retry via `attempts`; distinct metric for triage | 10, 18 |
| Queue (Redis) down | `CREATED`-status reconciliation sweep | 9, 6 |
| DB (Mongo) down | Job exception → retry via `attempts`; both the primary write and the failure-handler's write are subject to the same retry | 10 |
| API process restart | Stateless — no in-memory state lost except open SSE connections, which clients reconnect via `EventSource`'s native retry + `Last-Event-ID` replay from Redis Streams | 14 |
| Redis flush mid-contest | Documented rebuild runbook from `Submission` collection (not automatic) | 13 |

## 20. Load Testing Strategy

Scenarios per the brief, sized against Section 15's model (each scenario's submission rate scaled proportionally from the 60/s-at-10k-users peak figure):

| Scenario | Concurrent users | Target submission rate | Target leaderboard viewers | Target SSE connections |
|---|---|---|---|---|
| 1 | 100 | ~0.6/s | 100 | 100 |
| 2 | 1,000 | ~6/s | 1,000 | 1,000 |
| 3 | 5,000 | ~30/s | 5,000 | 5,000 |
| 4 | 10,000 | ~60/s | 10,000 | 10,000 |

Simulated per scenario: contest registration burst (all target users registering within a short window before scenario start), problem-detail requests (one per user per problem, front-loaded), submissions at the scenario's target rate with realistic burst shaping (front/back-loaded per Section 15's assumptions, not uniform), rapid resubmission by a subset of users (to exercise the idempotency guard from Section 9), simultaneous submissions at the exact contest-start instant (worst-case burst), leaderboard reads (both the initial page-load wave and the steady-state SSE-driven low rate — explicitly test that leaderboard *read* endpoint traffic stays low even at 10,000 SSE-connected viewers, validating the Section 15 claim), and SSE connection churn (a fraction of clients disconnecting/reconnecting mid-test to exercise replay).

Measured: p50/p95/p99 for API latency and for judge job wait time and judge execution time separately (these are different things and both matter — a fast API that queues a submission behind a deep queue still feels slow to the user), overall throughput, error rate, MongoDB and Redis load (ops/sec, connection pool saturation), CPU/memory on API and worker hosts, worker utilization (active containers vs. configured concurrency).

**Acceptable thresholds (proposed defaults, tune per real infra):** p95 API latency (non-judge endpoints) < 300ms at all four scenarios; p95 job wait time (enqueue → RUNNING) < 10s at Scenario 4 peak burst (this is the number most sensitive to worker fleet sizing from Section 15 and the one most worth alerting on); error rate < 0.1% excluding intentionally-rejected (429/403) requests; zero leaderboard rank inconsistencies (validated by comparing the live Redis-served leaderboard against a from-scratch Mongo recomputation at test end — see Section 21).

Tooling: **UNKNOWN — REQUIRES DECISION.** No load-testing tool is currently present in the repo (confirmed — no `k6`, `artillery`, or similar config found). A tool needs to support both plain HTTP burst load (submissions, registration) and long-lived SSE connections (most HTTP load tools handle SSE poorly) — k6 (with its experimental SSE support) or a custom Node-based harness using `EventSource` clients are both plausible; this decision should be made in Phase 8 planning, not pre-committed here (ISSUE-134).

## 21. Backend Verification Checklist

Before frontend work (Phase 10) begins:

**Normal practice:** user can submit (existing, already works) → job enters queue with correct options (Section 9) → worker executes with configured concurrency (Section 10) → result persisted with correct indexes exercised (Section 5) → client receives result (existing polling still valid for practice mode — SSE is additive, not a replacement requirement for practice submissions, since practice doesn't have the 10k-concurrent-viewer problem).

**Concurrent submissions:** multiple submissions execute safely at the tuned `WORKER_CONCURRENCY` without cross-submission sandbox collisions (already guarded by the existing `${language}-${jobId}` namespacing plus the attempt-number addition in Section 9); queue remains stable under the Scenario 4 load test (Section 20).

**Contest:** users can register (unique-index-guarded, Section 7); contest starts and stops on backend clock, not client (Section 12); submissions are accepted only within the RUNNING window; scoring is correct (verified by comparing Redis-served standings against an independent from-scratch recomputation from the `Submission` collection — this comparison IS the acceptance test for the entire scoring design, not just a nice-to-have); penalties compute correctly per the chosen formula (Section 12/5.4); leaderboard updates correctly and only on rank-changing events (verified by asserting `ZADD` call count equals accepted-first-solve count, not total submission count, during the load test).

**Real-time:** users receive `submission.completed` and `leaderboard.updated` events within a bounded latency (measured in Section 20); reconnect resumes from `Last-Event-ID` without gaps (explicit disconnect/reconnect test); duplicate event delivery doesn't corrupt state (verified via the idempotent-`SADD` design — assert a manually-duplicated event doesn't change the score a second time).

**Failure recovery:** each row of Section 19's table has a corresponding chaos test (kill a worker process mid-job; kill the Docker daemon; drop the Mongo connection; drop the Redis connection; kill and restart an API instance) with the documented recovery behavior asserted, not just hoped for.

**Scale:** the full Scenario 4 (10,000-user) load test from Section 20 passes its thresholds; no leaderboard inconsistency (per the comparison test above); no unbounded resource growth over the test's duration (specifically: Redis memory stays bounded given `removeOnComplete`/`removeOnFail` from Section 9, and container count returns to zero between bursts, verified via `docker ps` count sampling during the test).

## 22. Frontend Work — Intentionally Deferred

Not implemented in this phase. Recorded here as required scope for Phase 10, once everything above is built and verified:

- Contest listing and detail pages (using the new `/api/v1/contests` endpoints)
- Contest registration UI
- Server-authoritative contest countdown/timer (client displays backend-provided `startTime`/`endTime`, re-syncs periodically rather than trusting client clock drift — a direct UI consequence of Section 12's backend-time-authority decision)
- Contest problem-solving interface (reusing the existing Monaco-based problem page, contest-scoped)
- Submission status UI updated to reflect the new 4-state lifecycle (`CREATED`/`QUEUED`/`RUNNING`/`COMPLETED`) instead of today's binary pending/completed display, and to remove the dead `status === "failed"` branch (Section 3/5.3)
- Live leaderboard component, SSE-driven (`EventSource` client, subscribing per Section 14), with a REST fallback fetch for initial load and for clients where SSE isn't available
- Live rank indicator for the current user
- Contest results page (post-finalization, reading `ContestLeaderboardSnapshot{isFinal:true}`)
- User contest history (extending the existing `/api/v1/user/stats` pattern with contest participation)
- Rating display (once the rating algorithm decision in ISSUE-118 is made)
- General submission-history/statistics UI improvements enabled by the new indexes (e.g., date-range-filterable history, since Section 5's `{userId:1, createdAt:-1}` index makes that cheap where today's unbounded full-history load is not)
- SSE client integration wiring (connection management, reconnect UX, `Last-Event-ID` handling — mostly framework-provided by `EventSource` but needs UI states for "reconnecting")

## 23. Complete Issue List

Grouped by phase. Each issue lists only the sections genuinely relevant to it, per the brief's instruction to omit non-applicable sections.

---

### ISSUE-101 — `RUNNING` submission status is never set

**Priority:** P0
**Objective:** Make the worker actually set `status: "running"` when it begins sandbox execution, so the state machine in Section 5.3 is real, not aspirational.
**Why This Is Needed:** Confirmed by grep across the entire repo — `RUNNING` is defined in `verdicts.js` but never written by `executionEngine.js` or anywhere else. Without it, there is no way to distinguish "queued, not yet picked up" from "actively judging" — both the future contest UX and the `submission.running` SSE event (Section 14) depend on this being real.
**Current Implementation:** `executeSubmission()` in `workers/common/executionEngine.js` goes straight from job pickup to sandbox setup with no intermediate DB write.
**Proposed Change:** Add one `updateSubmission(submissionId, {status: "running"})`-equivalent write immediately after `loadDetails()` succeeds and before `sandbox.start()`.
**Files/Modules Affected:** `workers/common/executionEngine.js`, `packages/shared/db/dbCalls.js` (may need a lighter-weight status-only update helper alongside the existing full-result `updateSubmission`)
**Database Changes:** none (status enum already includes `running`)
**Testing Requirements:** unit test asserting the DB write occurs before sandbox start; integration test polling status mid-execution
**Dependencies:** none
**Blocks:** ISSUE-106 (SSE `submission.running` event), any contest UI showing "Judging..."
**Acceptance Criteria:** a submission's status is observably `running` for the duration of its sandbox execution, not just `pending` then `completed`.

---

### ISSUE-102 — Remove dead `status === "failed"` branch in frontend polling

**Priority:** P2
**Objective:** Delete the frontend's check for a submission status value that doesn't exist in the shared contract.
**Why This Is Needed:** Contract drift — `frontend/app/problems/[slug]/page.tsx`'s `pollSubmission` checks `data.submission.status === "completed" || data.submission.status === "failed"`, but `SUBMISSION_STATUS` has never included `"failed"`. This is dead code that also slightly obscures the actual terminal-state contract for anyone reading the frontend to understand backend behavior.
**Current Implementation:** as above.
**Proposed Change:** remove the `|| data.submission.status === "failed"` clause.
**Files/Modules Affected:** `frontend/app/problems/[slug]/page.tsx`
**Testing Requirements:** none beyond existing manual submission flow verification
**Dependencies:** none
**Acceptance Criteria:** polling logic only checks for real status values.

---

### ISSUE-103 — Add `Submission` indexes

**Priority:** P0
**Objective:** Add the four indexes specified in Section 5.2 (`userId+createdAt`, `userId+questionId`, `contestId+userId+contestProblemId+verdict`, `contestId+status`).
**Why This Is Needed:** Zero secondary indexes exist on `Submission` today (confirmed by grep). This is the single highest-impact, lowest-risk fix in the entire roadmap and should ship independently of everything else.
**Current Implementation:** `packages/shared/models/Submission.js` — schema fields only, no `index:` declarations, no `.index()` calls.
**Proposed Change:** add index declarations to the schema.
**Files/Modules Affected:** `packages/shared/models/Submission.js`
**Database Changes:** index creation (background, non-blocking on a collection of current size; recommend running with `mongoose.set('autoIndex', false)` in production and creating indexes explicitly during a maintenance step if the collection is ever large enough for foreground index builds to matter — not currently the case, flagged for awareness)
**Testing Requirements:** verify via `db.submissions.getIndexes()` in a test environment; verify `user.route.js`'s `/stats` query plan uses the new index (`explain()`)
**Dependencies:** none
**Blocks:** ISSUE-104, all Contest/Scoring work (Section 12) that queries by `contestId`
**Acceptance Criteria:** the four indexes exist; `/stats` and contest-scoping queries show indexed access in `explain()` output.

---

### ISSUE-104 — Bound the `/stats` unbounded submission query

**Priority:** P1
**Objective:** Stop loading a user's entire submission history into memory on every dashboard load.
**Why This Is Needed:** `user.route.js`'s `/stats` handler runs `Submission.find({ userId })` with no `.limit()` — confirmed in the file. Combined with ISSUE-103's new index, the query becomes fast, but it's still unbounded in result-set size for a heavy user.
**Current Implementation:** as above, followed by in-memory aggregation (streaks, solved-by-difficulty, etc.) over the full result set.
**Proposed Change:** either (a) cap the query with a reasonable window (e.g., last 12 months) sufficient for the existing streak/activity calculations, or (b) maintain incremental counters on the `User` document updated at submission-completion time instead of recomputing from full history on every read — (b) is the more scalable long-term fix but is a larger change; recommend (a) as the immediate P1 fix and (b) as a P2 follow-up (ISSUE-135) if profiling shows it's still needed after (a) and the new index.
**Files/Modules Affected:** `backend/routes/user.route.js`
**Database Changes:** none beyond ISSUE-103's index (already covers the query shape)
**Testing Requirements:** verify stats correctness is unchanged for a user with a bounded history; add a test with a synthetically large submission history to confirm bounded query time
**Dependencies:** ISSUE-103
**Acceptance Criteria:** `/stats` response time does not scale linearly with a user's all-time submission count.

---

### ISSUE-105 — Configure BullMQ job options (retries, backoff, cleanup, priority)

**Priority:** P0
**Objective:** Implement the job-options configuration specified in Section 9.
**Why This Is Needed:** `Queue.add("execute", {submissionId})` is called with zero options today (confirmed in `backend/routes/submission.route.js`) — no retries, no backoff, unbounded Redis retention of completed/failed job data.
**Current Implementation:** as above.
**Proposed Change:** add `attempts`, `backoff`, `removeOnComplete`, `removeOnFail`, `priority` per Section 9's exact configuration.
**Files/Modules Affected:** `backend/routes/submission.route.js` (and the new contest-submission route once it exists, ISSUE-116)
**Queue Changes:** as above.
**Failure Handling:** directly improves the "worker crash" and "Mongo/Redis blip" failure modes in Section 10's table by making them retryable instead of terminal-on-first-failure.
**Testing Requirements:** integration test that kills a worker mid-job and asserts the job is retried and eventually completes; test that Redis job-key count stays bounded after a burst of completions
**Dependencies:** ISSUE-111 (attempt-numbered sandbox directories, so retries don't collide with in-progress cleanup)
**Acceptance Criteria:** a transient worker failure no longer permanently strands a submission; Redis job-data footprint is bounded under sustained load.

---

### ISSUE-106 — Emit submission lifecycle events (`created`/`queued`/`running`/`completed`)

**Priority:** P1
**Objective:** Publish the four submission-lifecycle events specified in Section 14 to Redis Streams.
**Why This Is Needed:** No event system exists today; this is the producer side that the SSE layer (ISSUE-117) consumes.
**Current Implementation:** none.
**Proposed Change:** add `XADD` calls at each of the four transition points (submission route for `created`/`queued`, `executionEngine.js` for `running`/`completed`, coordinating with ISSUE-101 for the `running` transition specifically).
**Files/Modules Affected:** `backend/routes/submission.route.js`, `workers/common/executionEngine.js`, new `packages/shared/events/` module for the publish helper (shared, since both API and workers publish)
**Event Changes:** as specified in Section 14's event table.
**Dependencies:** ISSUE-101
**Blocks:** ISSUE-117 (SSE endpoint), ISSUE-108's scoring consumer (which listens for `submission.completed`)
**Acceptance Criteria:** all four events are observable on their Redis Stream for every submission, in order, exactly matching the actual state transitions.

---

### ISSUE-107 — Configurable worker concurrency

**Priority:** P0
**Objective:** Implement `WORKER_CONCURRENCY` per Section 10, item 1.
**Why This Is Needed:** this is the single biggest lever for the entire 10k-user goal — current hardcoded concurrency of 1 caps the whole system at 3 concurrent judge executions.
**Current Implementation:** `new Worker(queueName, processor, { connection })` — no `concurrency` option, in `workers/common/workerFactory.js`.
**Proposed Change:** `concurrency: Number(process.env.WORKER_CONCURRENCY) || 1` — default preserves current behavior exactly.
**Files/Modules Affected:** `workers/common/workerFactory.js`
**Worker Changes:** as above.
**Testing Requirements:** load test at several concurrency values to determine safe per-host ceiling (feeds Section 15/20's sizing); regression test confirming default (unset env var) behaves identically to today.
**Dependencies:** ISSUE-111 (attempt-numbered sandbox keys become more important at higher concurrency, since more jobs are in flight simultaneously — though the existing language+jobId namespacing already prevents same-host collisions regardless of concurrency)
**Blocks:** the entire Section 15 capacity model; Phase 8 load testing
**Acceptance Criteria:** setting `WORKER_CONCURRENCY=N` results in up to N concurrent Docker sandbox executions per worker process, verified via `docker ps` count during a burst test.

---

### ISSUE-108 — `CREATED`-status reconciliation sweep

**Priority:** P1
**Objective:** Self-heal submissions that got a Mongo write but never reached the queue (Redis-down window).
**Why This Is Needed:** identified in Section 10's failure-mode table — today, if `Queue.add` throws after `Submission.create` succeeds, the submission is permanently stuck.
**Current Implementation:** none — this failure mode currently results in a permanently `pending` submission with a 500 returned to the client (who has no way to know whether to retry, risking a duplicate per ISSUE-112).
**Proposed Change:** a scheduled task (interval TBD, e.g. every 30s) that finds `Submission` documents in `CREATED` status older than a short grace period (e.g. 10s, to avoid racing a submission that's enqueuing normally) and re-attempts enqueue.
**Files/Modules Affected:** new `backend/jobs/reconcileSubmissions.js` or similar
**Database Changes:** relies on ISSUE-103's indexes for the sweep query to be cheap (`status: 'CREATED', createdAt: {$lt: ...}` — add this to the index list if not already covered by `{contestId:1, status:1}`; practice submissions have `contestId: null`, so a general `{status:1, createdAt:1}` index may be needed as a follow-up, ISSUE-136)
**Failure Handling:** directly addresses the "Queue (Redis) unavailable" row of Section 10's table.
**Testing Requirements:** integration test simulating a Redis outage during enqueue, asserting the sweep recovers the submission once Redis is back.
**Dependencies:** ISSUE-103 (or ISSUE-136 follow-up index)
**Acceptance Criteria:** no submission can remain permanently un-enqueued after a transient Redis outage.

---

### ISSUE-109 — Tune BullMQ stalled-job detection

**Priority:** P0
**Objective:** Configure `lockDuration`/`stalledInterval` correctly relative to the judge's own 45s worst-case deadline.
**Why This Is Needed:** untuned defaults risk either false-positive requeue-and-double-execute of a legitimately-slow-but-still-running submission, or too-slow detection of a genuinely dead worker — both matter more once concurrency (ISSUE-107) means more jobs are in flight and a single worker crash affects more submissions at once.
**Current Implementation:** BullMQ defaults, unexamined/unconfigured.
**Proposed Change:** set `lockDuration` comfortably above `OVERALL_SUBMISSION_TIMEOUT_MS` (45000ms) — e.g. 60000ms — with `stalledInterval` and `maxStalledCount` tuned so a truly-dead worker's jobs are recovered within a bounded, documented window without false-positiving on legitimate long-running submissions.
**Files/Modules Affected:** `workers/common/workerFactory.js`
**Worker Changes:** as above.
**Testing Requirements:** kill a worker process mid-execution (SIGKILL, not graceful) and assert the job is detected as stalled and retried within the configured window, without a false positive occurring during normal 40+ second legitimate executions.
**Dependencies:** none
**Acceptance Criteria:** documented, tested stalled-job recovery window that is provably longer than the judge's own worst-case execution time.

---

### ISSUE-110 — Orphaned container sweep

**Priority:** P1
**Objective:** Backstop cleanup for containers left behind by a hard-killed worker process.
**Why This Is Needed:** `DockerSandbox.destroy()`'s cleanup only runs if the worker process itself is alive to run it; a `SIGKILL` to the worker process leaves the container running until its own idle-timeout `sleep 120` expires.
**Current Implementation:** none beyond the container's own 120-second idle-sleep self-expiry.
**Proposed Change:** a periodic (e.g. every 60s) per-host sweep: `docker ps --filter "name=sandbox-" --format ...`, parse the embedded timestamp from the container name (already present: `sandbox-${jobId}-${Date.now()}-${randomSuffix}`), force-remove any older than a safety margin beyond the worst-case submission deadline.
**Files/Modules Affected:** new `workers/common/sweepOrphans.js`, invoked from each worker entrypoint or as a separate cron-style process
**Worker Changes:** as above.
**Security Considerations:** sweep must only target containers matching the `sandbox-` naming convention, never touch unrelated containers on the host.
**Testing Requirements:** simulate an orphaned container (start one manually, don't clean it up) and confirm the sweep removes it after its age threshold.
**Dependencies:** none
**Acceptance Criteria:** no `sandbox-*` container survives more than [safety margin] beyond its worst-case lifetime, even across worker process hard-kills.

---

### ISSUE-111 — Namespace sandbox directories by attempt number

**Priority:** P0
**Objective:** Prevent a retried job (ISSUE-105) from colliding with a prior failed attempt's in-progress cleanup.
**Why This Is Needed:** today's `${language}-${job.id}` key (the existing ISSUE-015 fix) is unique per job but not per *attempt* — once retries are enabled, a job can execute more than once under the same `job.id`.
**Current Implementation:** `executionKey = \`${config.language}-${job.id}\`` in `workers/common/executionEngine.js`.
**Proposed Change:** `executionKey = \`${config.language}-${job.id}-${job.attemptsMade}\``.
**Files/Modules Affected:** `workers/common/executionEngine.js`
**Testing Requirements:** force a job to fail and retry, assert the two attempts use distinct sandbox directories and neither's cleanup interferes with the other.
**Dependencies:** none (independent of, but should land alongside, ISSUE-105)
**Blocks:** ISSUE-105 (retries aren't safe to enable without this)
**Acceptance Criteria:** retried attempts never share a sandbox directory with a prior attempt of the same job.

---

### ISSUE-112 — Submission idempotency guard

**Priority:** P1
**Objective:** Prevent duplicate judge runs from a client-side retry of a submission POST.
**Why This Is Needed:** identified in Section 9 — no idempotency mechanism exists today; a network-level retry (or a double-click, or a flaky-connection resend) creates two `Submission` documents and two judge runs for what the user experienced as one action.
**Current Implementation:** none.
**Proposed Change:** short-TTL Redis key (`idempotency:submission:{hash(userId+questionId+code)}`, 60s) checked and set atomically (`SET ... NX EX 60`) before creating the `Submission` document; a hit returns the existing submission's ID instead of creating a new one.
**Files/Modules Affected:** `backend/routes/submission.route.js`
**Redis Changes:** as above (Section 13's `idempotency:submission:{hash}` key).
**Testing Requirements:** rapid double-POST of identical `{language, code}` to the same question within the TTL window returns the same `submissionId` both times.
**Dependencies:** none
**Acceptance Criteria:** identical rapid resubmission does not create duplicate judge executions.

---

### ISSUE-113 — Per-host worker concurrency budgeting documentation

**Priority:** P1
**Objective:** Document (not code — this is a deployment-config decision) safe `WORKER_CONCURRENCY` values relative to host CPU/memory, per Section 10 item 2.
**Why This Is Needed:** raising concurrency without a documented per-host budget risks oversubscribing real host resources even though each container individually caps at `--cpus=1 --memory=256m`.
**Current Implementation:** N/A.
**Proposed Change:** a section in the worker deployment docs (README or new `workers/DEPLOYMENT.md`) with a formula (e.g. `WORKER_CONCURRENCY ≈ host_cores - headroom`) and the reasoning from Section 15's capacity model.
**Files/Modules Affected:** documentation only
**Dependencies:** ISSUE-107
**Acceptance Criteria:** a documented, load-test-validated per-host-class concurrency recommendation exists before production rollout.

---

### ISSUE-114 — (see ISSUE-113 — merged; kept as a cross-reference number to match Section 10/11's citations)

*Note: Sections 10 and 11 both reference "ISSUE-114" for the per-host admission-control concern; this is the same concern as ISSUE-113 above (concurrency IS the admission control) and is tracked as one issue, not two. Referenced here only so the cross-references above resolve.*

---

### ISSUE-115 — Graceful worker shutdown

**Priority:** P1
**Objective:** `SIGTERM` handling so in-flight jobs finish before a worker process exits, per Section 10 item 6.
**Why This Is Needed:** needed for zero-downtime worker deploys, especially during a live contest where a rolling worker-fleet update shouldn't kill in-progress judge runs.
**Current Implementation:** none — worker processes have no shutdown handling.
**Proposed Change:** `process.on('SIGTERM', async () => { await worker.close(); process.exit(0); })` in each `worker.js` entrypoint, relying on BullMQ's `Worker.close()` to stop accepting new jobs and wait for in-flight ones.
**Files/Modules Affected:** `workers/javascript/worker.js`, `workers/java/worker.js`, `workers/python/worker.js`
**Testing Requirements:** send `SIGTERM` to a worker mid-job, assert the in-flight job completes and is not requeued/duplicated, and the process exits only after.
**Dependencies:** none
**Acceptance Criteria:** rolling worker deploys don't interrupt in-flight submissions.

---

### ISSUE-116 — Contest data models

**Priority:** P0
**Objective:** Implement `Contest`, `ContestParticipant`, `ContestLeaderboardSnapshot`, and the `User`/`Submission` schema extensions from Section 5.2.
**Why This Is Needed:** foundational — nothing in Phase 5/6 (contest engine, leaderboard) can exist without this.
**Current Implementation:** none of these models exist.
**Proposed Change:** as specified in Section 5.2, added to `packages/shared/models/` (new files) and extending the existing `Submission`/`User` schemas.
**Files/Modules Affected:** new `packages/shared/models/Contest.js`, `ContestParticipant.js`, `ContestLeaderboardSnapshot.js`; edits to `packages/shared/models/Submission.js`, `backend/models/User.js`
**Database Changes:** new collections + indexes as specified in 5.2.
**Testing Requirements:** schema validation tests; index existence tests
**Dependencies:** ISSUE-103 (establishes the pattern/precedent for adding indexes to this codebase's models)
**Blocks:** every subsequent contest/scoring/leaderboard issue
**Acceptance Criteria:** all new models exist with the specified fields and indexes; existing `Submission`/`User` behavior is unchanged for documents without the new optional fields populated.

---

### ISSUE-117 — Contest lifecycle scheduler

**Priority:** P0
**Objective:** Implement the backend-authoritative `DRAFT→SCHEDULED→REGISTRATION→RUNNING→ENDED` automatic transitions from Section 12.
**Why This Is Needed:** "the backend must be authoritative" is a hard requirement from the brief; nothing today drives contest state off the server clock, because contests don't exist yet.
**Current Implementation:** none.
**Proposed Change:** a scheduled task (e.g. every 5–10s) comparing `now` against each `SCHEDULED`/`REGISTRATION`/`RUNNING` contest's relevant timestamp and advancing status; on `REGISTRATION→RUNNING`, pre-seed Redis leaderboard structures (Section 12, with the pre-seeding default flagged as ISSUE-126's open question).
**Files/Modules Affected:** new `backend/jobs/contestScheduler.js`
**Database Changes:** relies on `Contest`'s `{status:1, startTime:1}` index (ISSUE-116)
**Event Changes:** emits `contest.started`/`contest.ended` (Section 14)
**Testing Requirements:** time-mocked tests for each transition; test that a contest scheduled to start advances to `RUNNING` within the scheduler's polling interval of its `startTime`, not before
**Dependencies:** ISSUE-116
**Acceptance Criteria:** contest status is never advanced by a client request; all transitions are observable within a bounded, documented latency after their trigger time.

---

### ISSUE-118 — Rating algorithm decision + implementation

**Priority:** P2 (decision needed early; implementation is not on the critical path to a first working contest)
**Objective:** Resolve the `UNKNOWN` flagged in Section 5.2/12 — pick and implement a rating update algorithm.
**Why This Is Needed:** the `User.rating` field is scaffolded (Section 5.2) but no algorithm is specified anywhere in the repo or brief.
**Current Implementation:** none.
**Proposed Change:** **UNKNOWN — REQUIRES DECISION** before implementation; this issue exists to hold the decision and its eventual implementation, not to prescribe one.
**Files/Modules Affected:** TBD pending decision
**Dependencies:** ISSUE-116 (`User.rating` field), contest finalization (part of ISSUE-119)
**Acceptance Criteria:** TBD pending decision.

---

### ISSUE-119 — Scoring model decision + Scoring consumer implementation

**Priority:** P0 (the consumer is on the critical path; the ICPC-vs-points decision should be made before this starts)
**Objective:** Implement the Scoring module (Section 6) that consumes `submission.completed` events for contest submissions and updates Redis per Section 5.4.
**Why This Is Needed:** this is the mechanism that satisfies "do NOT recalculate the entire leaderboard from MongoDB after every submission" — it's the core of Phase 6.
**Current Implementation:** none.
**Proposed Change:** as specified in Section 5.4 — idempotent `SADD`-guarded solved-check, `INCR` wrongcount, single `ZADD` per rank-changing event.
**Files/Modules Affected:** new `backend/consumers/scoringConsumer.js` (or a worker-side consumer, depending on deployment topology decision — either is architecturally valid since it only needs Redis Stream read access and Mongo read access, not Docker; recommend running it as its own lightweight process rather than folding into the API or judge workers, to scale/restart independently)
**Redis Changes:** as specified in Section 5.4/13.
**Event Changes:** consumes `submission.completed`; emits `leaderboard.updated`/`rank.updated`
**Security Considerations:** must not trust client-supplied data — reads the authoritative `Submission` document, not the event payload, for anything score-affecting.
**Failure Handling:** must be safe to restart and resume (Redis Streams consumer groups, not plain pub/sub — Section 14) without double-counting; the `SADD`-based idempotency guard is the core safety mechanism.
**Testing Requirements:** exactly the acceptance-criteria comparison described in Section 21 ("Redis-served standings match independent from-scratch Mongo recomputation"); duplicate-event-delivery test.
**Dependencies:** ISSUE-116, ISSUE-106, scoring-model decision (this issue, resolved before implementation starts)
**Blocks:** ISSUE-120 (leaderboard read API), all of Phase 6
**Acceptance Criteria:** Section 21's scoring-correctness comparison test passes under load (Section 20's Scenario 4).

---

### ISSUE-120 — Leaderboard read API

**Priority:** P0
**Objective:** Implement `GET /api/v1/contests/:id/leaderboard` and `/leaderboard/me` per Section 7.
**Why This Is Needed:** the read side of the leaderboard, serving from Redis with the Mongo-snapshot fallback for ended contests.
**Current Implementation:** none.
**Proposed Change:** as specified in Section 7/5.4.
**Files/Modules Affected:** new `backend/routes/contest.route.js` (or split into `contest.route.js` + `leaderboard.route.js`)
**API Changes:** as specified in Section 7.
**Database Changes:** none beyond ISSUE-116's models.
**Testing Requirements:** correctness against the Section 21 comparison test; fallback-to-snapshot test for `FINALIZED` contests after the live Redis key's TTL has notionally expired.
**Dependencies:** ISSUE-119
**Acceptance Criteria:** top-N, single-user-rank, and nearby-users queries all return correct results with no Mongo read on the running-contest path.

---

### ISSUE-121 — Periodic leaderboard snapshotting + finalization + rebuild runbook

**Priority:** P1
**Objective:** Implement `ContestLeaderboardSnapshot` writes (periodic + final) and document the Redis-flush rebuild procedure from Section 13.
**Why This Is Needed:** durability backstop for the Redis-primary leaderboard design.
**Current Implementation:** none.
**Proposed Change:** scheduled snapshot writer (configurable interval, default 30s) while any contest is `RUNNING`; a finalization handler on the (manual, per Section 12) `ENDED→FINALIZED` admin action that writes the final snapshot and sets the Redis key's TTL.
**Files/Modules Affected:** new `backend/jobs/leaderboardSnapshot.js`; `admin.route.js` extension for the finalize action
**Database Changes:** writes to `ContestLeaderboardSnapshot` (ISSUE-116)
**Redis Changes:** sets TTL on the live leaderboard key at finalization (Section 5.4)
**Testing Requirements:** snapshot content matches live Redis state at time of write; finalization is idempotent (re-running it doesn't produce a second `isFinal:true` document — enforce via the `{contestId:1, isFinal:1}` index plus an application-level check)
**Dependencies:** ISSUE-119, ISSUE-116
**Acceptance Criteria:** a full Redis flush mid-contest is recoverable per the documented runbook, validated by an actual disaster-recovery drill in staging.

---

### ISSUE-122 — Contest visibility decision (public vs. authenticated leaderboard)

**Priority:** P3
**Objective:** Resolve the `UNKNOWN` in Section 7 regarding whether contest leaderboards are publicly readable.
**Why This Is Needed:** affects whether `GET .../leaderboard` requires `authMiddleware`.
**Proposed Change:** **UNKNOWN — REQUIRES DECISION**; default assumed public for planning purposes (Section 7), confirm before ISSUE-120 ships.
**Dependencies:** none
**Blocks:** finalizing ISSUE-120's auth requirement
**Acceptance Criteria:** TBD pending decision.

---

### ISSUE-123 — Submission cancellation

**Priority:** P3 (explicitly out of critical path per Section 9)
**Objective:** Resolve the `UNKNOWN` around whether in-flight submission cancellation is needed, and implement if so.
**Proposed Change:** **UNKNOWN — REQUIRES DECISION.**
**Dependencies:** none
**Acceptance Criteria:** TBD pending decision.

---

### ISSUE-124 — Distinguish infra-failure verdicts from genuine user-code failure verdicts

**Priority:** P2
**Objective:** Add a metric/log distinction (not a user-facing verdict change) between a `Runtime Error` caused by Docker/Mongo unavailability vs. actual user code crashing, per Section 10's failure-mode table.
**Why This Is Needed:** currently both surface identically as `Runtime Error` to the user (correct UX — not changing that) but are indistinguishable in logs/metrics, which matters for on-call triage during a contest.
**Current Implementation:** `workerFactory.js`'s `failed` handler assigns `Runtime Error` uniformly.
**Proposed Change:** tag the internal log/metric (not the user-facing verdict) based on whether the exception originated in `DockerSandbox.start()` (infra) vs. inside `runInteractiveBatch`/test execution (user code).
**Files/Modules Affected:** `workers/common/workerFactory.js`, `workers/common/dockerSandbox.js` (error typing)
**Testing Requirements:** simulate a Docker-daemon-down failure and a user-code-crash failure, assert they're distinguishable in logs/metrics but identical in the user-facing verdict.
**Dependencies:** ISSUE-131 (structured logging), ISSUE-132 (metrics)
**Acceptance Criteria:** on-call can distinguish "judge infra is unhealthy" from "users are submitting broken code" without reading raw logs.

---

### ISSUE-125 — (cross-reference to ISSUE-117 — the contest scheduler IS the "backend time authority" mechanism)

*Note: Section 12 cites "ISSUE-125" for the scheduler; this is the same work as ISSUE-117, tracked as one issue.*

---

### ISSUE-126 — Leaderboard pre-seeding decision

**Priority:** P3
**Objective:** Resolve whether the leaderboard ZSET is pre-seeded with all registered participants at score 0 when a contest starts, or begins empty.
**Proposed Change:** **UNKNOWN — REQUIRES DECISION**; Section 12 defaults to pre-seeding for predictability.
**Dependencies:** ISSUE-117
**Acceptance Criteria:** TBD pending decision.

---

### ISSUE-127 — Combine the two sequential `getQuestionDetails` reads into one round trip

**Priority:** P3
**Objective:** Minor cleanup — `Promise.all` the submission and question reads in `getQuestionDetails`.
**Why This Is Needed:** explicitly **not** a performance necessity at any modeled scale (Section 5.5) — flagged purely as a code-quality nice-to-have, included so it isn't silently forgotten, not because it's load-bearing.
**Current Implementation:** `packages/shared/db/dbCalls.js`'s `getQuestionDetails` awaits the submission read, then awaits the question read.
**Proposed Change:** the question lookup depends on `submission.questionId`, so full parallelization isn't directly possible without restructuring — this issue is downgraded to "consider whether it's worth restructuring" rather than a concrete change; genuinely low priority.
**Dependencies:** none
**Acceptance Criteria:** N/A — evaluate and close as won't-fix if restructuring isn't worth the churn.

---

### ISSUE-128 — Load balancer long-idle-timeout configuration for SSE

**Priority:** P1
**Objective:** Ensure the production load balancer/reverse proxy doesn't prematurely terminate long-lived SSE connections.
**Why This Is Needed:** SSE connections (Section 14) are intentionally long-lived; a default LB idle timeout (often 60s) would kill them well before a 90-minute contest ends.
**Current Implementation:** N/A — infra configuration, not code, and not yet provisioned for SSE at all.
**Proposed Change:** document and configure appropriate idle-timeout settings (or a keep-alive comment/ping event sent periodically over the SSE stream itself, which is a portable code-level mitigation independent of any specific LB — recommend implementing this regardless of LB config, as defense in depth).
**Files/Modules Affected:** SSE endpoint implementation (ISSUE-117 dependency — actually depends on the SSE endpoint issue, see below), infra config/docs
**Dependencies:** ISSUE-137 (SSE endpoint implementation)
**Acceptance Criteria:** an SSE connection survives a full contest duration without being silently dropped by intermediate infrastructure.

---

### ISSUE-129 — Cap `limit` on new admin contest/participant list endpoints

**Priority:** P2
**Objective:** Apply the existing `Math.min(limit, 100)` pattern (already used in `question.route.js`, per the closed ISSUE-011) to any new admin-facing paginated contest/participant lists.
**Why This Is Needed:** consistency with an already-established, already-correct pattern in this codebase — avoid reintroducing the class of bug ISSUE-011 already fixed once.
**Files/Modules Affected:** new admin contest-management routes (part of ISSUE-116/117's admin surface)
**Dependencies:** ISSUE-116
**Acceptance Criteria:** every new list endpoint caps `limit` server-side regardless of client-supplied value.

---

### ISSUE-130 — JWT lifetime/revocation review

**Priority:** P3 (explicitly out of scope for the 10k-contest-user goal, tracked so it isn't confused with in-scope work)
**Objective:** Separately evaluate whether the current 30-day JWT with no revocation mechanism is acceptable.
**Proposed Change:** out of scope for this roadmap; tracked for a future security review.
**Dependencies:** none
**Acceptance Criteria:** N/A — explicitly deferred.

---

### ISSUE-131 — Structured logging

**Priority:** P2
**Objective:** Replace `console.log`/`console.error` with structured (JSON) logging on the highest-value paths first, per Section 18.
**Files/Modules Affected:** incrementally, starting with `workers/common/executionEngine.js`, `workers/common/workerFactory.js`, `backend/routes/submission.route.js`
**Dependencies:** none
**Blocks:** ISSUE-124 (needs structured fields to tag infra-vs-user failures)
**Acceptance Criteria:** submission/job lifecycle events are queryable as structured log data, not just grep-able text.

---

### ISSUE-132 — Metrics endpoint

**Priority:** P1
**Objective:** Implement the `/metrics` endpoint and metric set from Section 18.
**Files/Modules Affected:** new `backend/routes/metrics.route.js`, instrumentation added across the API and worker code paths
**Dependencies:** none (can proceed in parallel with most other Phase work, but should land before Phase 8 load testing, since load testing needs these metrics to be meaningful)
**Blocks:** Section 20's load-testing measurement plan
**Acceptance Criteria:** all metrics listed in Section 18 are exposed and populated under real traffic.

---

### ISSUE-133 — Health/readiness endpoints

**Priority:** P1
**Objective:** Implement `/health/live` and `/health/ready` per Section 18.
**Files/Modules Affected:** `backend/app.js` (new routes), worker processes (readiness needs a Docker-daemon check, which the API process doesn't need)
**Dependencies:** none
**Blocks:** any horizontal-scaling deployment automation (Section 15) that needs a real readiness signal
**Acceptance Criteria:** an instance with a broken Mongo/Redis connection (or, for workers, a broken Docker daemon) fails its readiness check and is removed from traffic by the orchestrator/LB.

---

### ISSUE-134 — Load testing tool selection

**Priority:** P1 (decision needed before Phase 8 execution, not before Phase 8 planning)
**Objective:** Resolve the `UNKNOWN` in Section 20 regarding load-testing tooling (must support both HTTP burst and long-lived SSE).
**Proposed Change:** **UNKNOWN — REQUIRES DECISION**; candidates noted in Section 20 (k6 with experimental SSE support, or a custom `EventSource`-based Node harness).
**Dependencies:** ISSUE-137 (needs a working SSE endpoint to test against)
**Acceptance Criteria:** a chosen tool can execute all four scenarios in Section 20 including the SSE-connection-churn test.

---

### ISSUE-135 — Incremental user-stats counters (follow-up to ISSUE-104)

**Priority:** P3
**Objective:** If profiling after ISSUE-103/104 still shows `/stats` as a hot endpoint, maintain incremental counters on `User` (solved counts, streaks) updated at submission-completion time instead of recomputing from history on every read.
**Dependencies:** ISSUE-104; only pursued if measurement shows it's still needed
**Acceptance Criteria:** conditional — only relevant if triggered by measurement.

---

### ISSUE-136 — General `{status:1, createdAt:1}` index for the reconciliation sweep

**Priority:** P1 (bundled dependency of ISSUE-108)
**Objective:** Add an index covering practice submissions (`contestId: null`) for the `CREATED`-status sweep query, since ISSUE-103's `{contestId:1, status:1}` index doesn't efficiently cover the practice-submission case (all sharing `contestId: null`).
**Files/Modules Affected:** `packages/shared/models/Submission.js`
**Dependencies:** ISSUE-103
**Blocks:** ISSUE-108
**Acceptance Criteria:** the reconciliation sweep query uses an index for both practice and contest submissions.

---

### ISSUE-137 — SSE endpoint implementation

**Priority:** P0
**Objective:** Implement `GET /api/v1/events` per Section 7/14 — the actual SSE endpoint, Redis Stream consumer loop, and per-instance connection fan-out.
**Why This Is Needed:** this is the concrete implementation the entire Phase 7 design in Section 14 describes; without it, ISSUE-106's published events have no consumer-facing delivery mechanism.
**Current Implementation:** none.
**Proposed Change:** as specified in Section 14 — authenticated SSE endpoint, per-instance `XREAD` loop per subscribed contest/user stream, `Last-Event-ID` support for reconnect replay.
**Files/Modules Affected:** new `backend/routes/events.route.js`
**Event Changes:** consumer side of everything in Section 14's event table.
**Testing Requirements:** connect/disconnect/reconnect-with-replay test; multi-instance fan-out test (two API instances, one connection each, both receive events for the same contest); load test at Scenario 4's 10,000-connection target (Section 20)
**Dependencies:** ISSUE-106
**Blocks:** ISSUE-128 (LB config depends on the endpoint existing), ISSUE-134 (load-test tool needs a real endpoint to target), all Frontend deferred work (Section 22)
**Acceptance Criteria:** a client can connect, receive live events, disconnect, reconnect with `Last-Event-ID`, and receive exactly the events missed during the gap — no more, no less.

---

## 24. Issue Dependency Graph

```
ISSUE-103 (Submission indexes)
   ↓
   ├─→ ISSUE-104 (bound /stats query) ──→ ISSUE-135 (incremental counters, conditional)
   ├─→ ISSUE-108 (reconciliation sweep) ←── ISSUE-136 (status+createdAt index)
   └─→ ISSUE-116 (Contest data models)
             ↓
        ISSUE-117 (Contest scheduler / backend time authority)
             ↓
        ┌────┴─────────────────────────┐
        ↓                               ↓
   ISSUE-119 (Scoring consumer)   ISSUE-118 (Rating decision, parallel)
        │  ← needs ISSUE-106
        ↓
   ISSUE-120 (Leaderboard read API)
        ↓
   ISSUE-121 (Snapshotting + finalization + rebuild runbook)

ISSUE-101 (RUNNING status set) ──→ ISSUE-106 (lifecycle events published) ──→ ISSUE-119, ISSUE-137
                                                                                    ↓
ISSUE-111 (attempt-numbered sandbox keys) ──→ ISSUE-105 (BullMQ job options)   ISSUE-137 (SSE endpoint)
                                                                                    ↓
ISSUE-107 (configurable concurrency) ──→ ISSUE-113 (host budgeting docs)    ISSUE-128 (LB idle-timeout config)
        ↓
ISSUE-109 (tuned stalled detection)
        ↓
ISSUE-110 (orphaned container sweep)
        ↓
ISSUE-115 (graceful shutdown)

ISSUE-131 (structured logging) ──→ ISSUE-124 (infra-vs-user failure tagging)
ISSUE-132 (metrics) ──────────────→ [feeds] ISSUE-134's load test measurement
ISSUE-133 (health checks) ────────→ [required for] horizontal deployment automation

ISSUE-134 (load test tool) ←── ISSUE-137
        ↓
   Phase 8 load testing (Section 20) — requires:
        ISSUE-107 (concurrency), ISSUE-105 (queue config), ISSUE-119+120 (scoring/leaderboard),
        ISSUE-137 (SSE), ISSUE-132 (metrics) all landed
        ↓
   Phase 9 backend verification (Section 21)
        ↓
   Phase 10 Frontend (Section 22) — entirely deferred until here
```

## 25. Priority System

- **P0 — critical architectural blockers for the 10k-contest-user goal:** ISSUE-101, 103, 105, 107, 109, 111, 116, 117, 119, 120, 137
- **P1 — required for target functionality:** ISSUE-104, 108, 110, 113/114, 115, 121, 128, 132, 133, 134, 136
- **P2 — important improvements, not blocking a first working contest:** ISSUE-102, 118 (decision-holding), 124, 129, 131
- **P3 — nice to have / explicitly deferred:** ISSUE-122, 123, 126, 127, 130, 135

This matches the brief's instruction: the 10k-user contest infrastructure work is concentrated entirely in P0/P1; low-priority product polish (dead-code cleanup, JWT lifetime review, a minor `Promise.all` refactor) is P2/P3 and does not gate the critical path.

## 26. Implementation Order

```
 1. ISSUE-103  Submission indexes
 2. ISSUE-101  Set RUNNING status
 3. ISSUE-111  Attempt-numbered sandbox keys
 4. ISSUE-105  BullMQ job options (retries/backoff/cleanup/priority)
 5. ISSUE-107  Configurable worker concurrency
 6. ISSUE-109  Tuned stalled-job detection
 7. ISSUE-110  Orphaned container sweep
 8. ISSUE-115  Graceful worker shutdown
 9. ISSUE-113  Per-host concurrency budgeting (docs, validated by early load tests)
10. ISSUE-104  Bound /stats query
11. ISSUE-108 + ISSUE-136  Reconciliation sweep + supporting index
12. ISSUE-112  Submission idempotency guard
13. ISSUE-116  Contest data models
14. ISSUE-117  Contest lifecycle scheduler
15. ISSUE-106  Submission lifecycle events published
16. ISSUE-119  Scoring consumer (scoring-model decision resolved first)
17. ISSUE-120  Leaderboard read API
18. ISSUE-121  Snapshotting + finalization + rebuild runbook
19. ISSUE-137  SSE endpoint
20. ISSUE-128  LB idle-timeout / keep-alive config
21. ISSUE-131  Structured logging
22. ISSUE-132  Metrics endpoint
23. ISSUE-133  Health/readiness endpoints
24. ISSUE-124  Infra-vs-user failure tagging
25. ISSUE-134  Load testing tool selection + execution (Section 20, all 4 scenarios)
26. Phase 9    Backend verification checklist (Section 21) — full pass required
27. ISSUE-102, 129  Remaining cleanup (can land any time after their trivial dependencies; sequenced last only because they're non-blocking)
28. Phase 10   Frontend (Section 22) — begins only after 26 is complete
```

Decisions that must be made **before** their dependent step above, tracked as standalone issues but not itself "implementation":
- Scoring model — **resolved (ICPC penalty)** in Phase 6 review; implement via ISSUE-601–608 before Phase 7 Redis
- Rating algorithm — before ISSUE-118, not on the critical path above
- Contest leaderboard visibility — **resolved** in Phase 6 review (`GET /standings` public, `GET /standings/me` authenticated); implement via ISSUE-608
- Submission cancellation — before or deferred past step 19, per ISSUE-123's P3 status
- Leaderboard pre-seeding — before step 14 (ISSUE-117)
- Load testing tool — before step 25 (ISSUE-134)

## 27. Definition of Done

The backend phase (Sections 1–21 of this document) is considered done when:

1. All P0 and P1 issues in Section 23 are implemented and individually tested per their own acceptance criteria.
2. The full Section 20 load test suite (Scenarios 1–4) passes against the thresholds proposed in Section 20 (or against thresholds explicitly revised and re-approved during Phase 8 planning).
3. The Section 21 backend verification checklist passes in full, including the scoring-correctness comparison test (Redis-served leaderboard matches an independent from-scratch Mongo recomputation) and the chaos-test suite covering every row of Section 19's failure-recovery table.
4. No leaderboard inconsistency, data corruption, or unbounded resource growth (Redis memory, orphaned containers, stuck submissions) is observed during or after the 10,000-user load test scenario.
5. Metrics (ISSUE-132) and health checks (ISSUE-133) are live in the target deployment environment, providing the operational visibility needed to run a real contest with confidence.
6. This document's `UNKNOWN — REQUIRES DECISION` items relevant to the P0/P1 critical path (scoring model, leaderboard visibility, pre-seeding) have been resolved and the corresponding issues updated to reflect the actual decision made, not left as placeholders.

Only once all of the above hold does Section 22's frontend work begin.
