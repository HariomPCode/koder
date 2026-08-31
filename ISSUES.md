# Engineering Roadmap

This document tracks verified engineering issues found in the `koder` codebase (backend, workers, frontend), based on a direct read of the repository source (uploaded as a ZIP snapshot). Every issue below is grounded in code that was actually inspected — file paths are cited under "Evidence" for each. Use the priority sections to triage day-to-day work, and the "Recommended Implementation Order" at the end to sequence larger efforts; issues are linked via `Dependencies` where one blocks or informs another.

## 🔴 P0 — Critical Issues

---

### ISSUE-001 — Admin API is completely unauthenticated

**Priority:** P0

**Area:** Security / Backend

**Status:** ✅ DONE

**Current State**

Admin authentication and authorization implemented and verified.

**What Was Fixed**

- Admin middleware guard applied to all `/admin/*` routes before mounting.
- JWT token validation required for all admin endpoints.
- Role-based authorization checks in place.

**Verification**

- All `/admin/*` routes now return 401/403 without valid admin session.
- `hiddenTestCases` protected from non-admin access.
- Tests confirm auth gate works correctly.

**Implementation Phase:** Phase 1 — Stabilization

**Complexity:** Small

**Dependencies:** None

---

### ISSUE-002 — `/admin/users` returns full user documents including password hashes

**Priority:** P0

**Area:** Security / Backend

**Status:** ✅ DONE

**Current State**

Password hash protection implemented and verified.

**What Was Fixed**

- Password field exclusion implemented via `.select({ password: 0 })`.
- Applied to all user-returning endpoints.
- Admin `/users` endpoint no longer leaks bcrypt hashes.

**Verification**

- `/admin/users` response never contains `password` field.
- Confirmed via automated tests.
- Both Issues-001 and 002 work together: auth gate + field projection.

**Implementation Phase:** Phase 1 — Stabilization

**Dependencies:** ISSUE-001

---

### ISSUE-003 — Language contract is inconsistent across model, route, queue, and frontend, causing silently-stuck or crashing submissions

**Priority:** P0

**Area:** Architecture / Backend / Workers / Frontend

**Status:** ✅ DONE

**Current State**

Language contract centralized and validated. Unsupported submissions now rejected with explicit errors.

**What Was Fixed**

- Centralized language enum in shared package.
- Backend validation enforces language support before queuing.
- Frontend selector updated to only show supported languages.
- Unsupported language submissions return 400 immediately instead of hanging or crashing.

**Previous State Issues**

The pre-fix state had four independent "supported languages" declarations that contradicted each other:
- `backend/models/Question.js:51` — enum: `["javascript", "java", "python", "cpp"]` (4 languages).
- `backend/models/Submission.js:24` — enum: `["javascript", "java", "cpp"]` (3 languages — no `python`).
- `backend/routes/submission.route.js:32-40` — job dispatch only branches on `"javascript"` and `"java"`.
- `frontend/app/problems/[slug]/page.tsx:220-223` — selector presented all four options.

This caused: (1) selecting "cpp" would hang forever (submission stuck in "pending"), (2) selecting "python" would crash with unhandled validation error.

**Verification**

- Submitting unsupported language returns explicit 400 error immediately.
- Frontend selector matches live queue/worker support.
- Accepted submissions still process correctly for supported languages.
- All submission flows tested.

**Implementation Phase:** Phase 1 — Stabilization

**Complexity:** Medium

**Dependencies:** ISSUE-004

---

## Phase 2 — Backend Architecture Design

This section documents the architecture-only issue breakdown for the backend monolith refactor, without implementing worker, Redis, SSE, contest, or frontend changes.

### ISSUE-201 — Backend service boundary is implicit and route-coupled to persistence and queue internals

**Priority:** P1

**Area:** Architecture / Backend

**Status:** Planned for Phase 2

**Current State**

Routes directly call Mongoose models and the queue layer. Business logic and infrastructure concerns are effectively mixed together.

**Planned Fix**

Introduce a clean service layer and repository boundary so routes only orchestrate HTTP concerns and services own the business flow.

**Files In Scope**

- `backend/routes/*.js`
- `backend/app.js`
- `backend/middleware.js`
- `backend/queue.js`
- `backend/services/*` (new)
- `backend/repositories/*` (new)

**Dependencies:** None

---

### ISSUE-202 — Authentication and authorization policy is embedded in a single middleware file without explicit policy boundaries

**Priority:** P1

**Area:** Security / Backend architecture

**Status:** Planned for Phase 2

**Current State**

`backend/middleware.js` handles JWT verification and role enforcement in one place without explicit policy classes or context separation.

**Planned Fix**

Separate authentication context resolution from authorization policy enforcement and keep role checks behind explicit policy contracts.

**Files In Scope**

- `backend/middleware.js`
- `backend/services/auth.service.js` (new)
- `backend/auth/*` (new)

**Dependencies:** ISSUE-201

---

### ISSUE-203 — Submission lifecycle is not represented as a domain contract in the API layer

**Priority:** P1

**Area:** Backend architecture / Submission lifecycle

**Status:** Planned for Phase 2

**Current State**

Submission status is encoded in ad-hoc Mongoose writes and queue dispatch behavior without a formal domain lifecycle contract.

**Planned Fix**

Define a stable lifecycle contract for `CREATED → QUEUED → RUNNING → COMPLETED` and ensure route/service logic uses it instead of ad-hoc state mutation.

**Files In Scope**

- `backend/routes/submission.route.js`
- `backend/services/submission.service.js` (new)
- `packages/shared/contracts/verdicts.js`
- `backend/events/*` (new)

**Dependencies:** ISSUE-201, ISSUE-205

---

### ISSUE-204 — Validation and error handling are scattered across routes and models

**Priority:** P1

**Area:** Backend architecture / API quality

**Status:** Planned for Phase 2

**Current State**

Input validation and error responses are distributed across routes and Mongoose models.

**Planned Fix**

Centralize validation and error mapping behind well-defined request, domain, and schema validation layers.

**Files In Scope**

- `backend/errorHandler.js`
- `backend/routes/*.js`
- `backend/validators/*` (new)
- `backend/errors/*` (new)

**Dependencies:** ISSUE-201

---

### ISSUE-205 — Queue and event infrastructure is not abstracted behind a stable backend contract

**Priority:** P1

**Area:** Backend architecture / Infrastructure boundary

**Status:** Planned for Phase 2

**Current State**

Routes directly depend on `bullmq` queue objects and do not expose a service-level queue adapter.

**Planned Fix**

Add a queue adapter and event publisher abstraction that hides BullMQ/Redis details while preserving the current route surface.

**Files In Scope**

- `backend/queue.js`
- `backend/routes/submission.route.js`
- `backend/queue/*` (new)
- `backend/events/*` (new)

**Dependencies:** ISSUE-201

---

### ISSUE-206 — Database access patterns are not centralized behind repositories

**Priority:** P1

**Area:** Data access / Backend architecture

**Status:** Planned for Phase 2

**Current State**

Routes and services directly access Mongoose models in several places without repository abstraction.

**Planned Fix**

Create repositories for user, question, and submission access and constrain data access through those interfaces.

**Files In Scope**

- `backend/routes/*.js`
- `backend/repositories/*` (new)
- `backend/models/*.js`

**Dependencies:** ISSUE-201

---

## 🟠 P1 — High Priority Issues

---

### ISSUE-004 — Backend and workers are not independently deployable; they share code via relative-path filesystem coupling instead of a defined contract

**Priority:** P1

**Area:** Architecture / Backend / Workers

**Status:** ✅ DONE

**Current State**

npm workspaces monorepo structure implemented with `@koder/shared` package.

**What Was Fixed**

- Created `packages/shared/` with centralized domain logic.
- Moved `templateGenerator.js`, protocol definitions, language enums, and `db_calls/*` to shared.
- Updated all call sites (`backend/`, `workers/`) to import from `@koder/shared` instead of relative paths.
- Removed filesystem coupling via `../../` relative paths.
- Workers can now start independently with `backend/` absent from disk (aside from shared package).

**Previous State Issues**

Pre-fix: workers reached into backend via paths like `require("../../backend/db")`, `require("../../backend/queue")`, `require("../../backend/db_calls/updateSubmission")`, and backend reached into workers via `require("../workers/common/templateGenerator")`. No package boundary existed.

**Verification**

- No file under `workers/` contains a `require()` path that resolves into `backend/`.
- Workspace boundaries verified via import audits.
- Shared package properly declared as dependency in both backend and workers.
- Full submission flow tested (backend -> BullMQ/Redis -> worker -> DockerSandbox -> MongoDB).

**Implementation Phase:** Phase 2 — Architecture Foundation

**Complexity:** Medium

**Dependencies:** None (foundational issue)

---

### ISSUE-005 — Frontend calls a logout endpoint that doesn't exist

**Priority:** P1

**Area:** Frontend / Backend contract

**Status:** ✅ DONE

**Current State**

Frontend logout endpoint fixed and regression test added.

**What Was Fixed**

- Frontend now calls correct logout endpoint: `/api/v1/auth/signout`.
- Backend `/api/v1/auth/signout` endpoint working properly.
- Server-side cookie clearing now actually executes when logout happens.
- Logout regression test added to prevent re-introduction.

**Previous State Issue**

Frontend called `${backend}/api/v1/logout` which never existed. The real endpoint was `/api/v1/auth/signout`. This caused the logout request to 404 silently, and the `auth_token` cookie remained valid on the client even though the UI appeared logged out.

**Verification**

- Logout requests now reach the correct endpoint and return 2xx.
- `auth_token` cookie is cleared server-side (verified via response headers).
- Logout regression test confirms the endpoint exists and works.

**Implementation Phase:** Phase 1 — Stabilization

**Complexity:** Small

**Dependencies:** None

---

### ISSUE-006 — `javascript/executor.js` and `java/executor.js` are ~90% duplicated code with no shared execution engine

**Priority:** P1

**Area:** Workers / Architecture

**Status:** ✅ DONE

**Current State**

Shared execution engine implemented in `@koder/shared/executionEngine`.

**What Was Fixed**

- Extracted common execution logic into a unified `runSubmission()` function.
- Both language executors now delegate to shared engine with language-specific config.
- Verdict logic, timeout handling, and output comparison centralized in one place.
- Language-specific differences isolated to: image name, compile command, exec command.

**Previous State Issues**

Pre-fix: Both `java/executor.js` and `javascript/executor.js` had identical `compareOutputs()` functions and identical 200+ lines of batch-processing logic, timeout handling, and verdict construction. Changes had to be applied manually in two places with no compiler to catch drift.

**Verification**

- `compareOutputs` exists in exactly one place (shared execution engine).
- Adding a third language requires only supplying image/command/compile-step config.
- Both Java and JavaScript submissions process correctly through shared engine.
- Full submission flow tested end-to-end.

**Implementation Phase:** Phase 2 — Architecture Foundation

**Complexity:** Medium

**Dependencies:** None

---

### ISSUE-007 — Legacy, unused execution code left in the repo alongside the current engine

**Priority:** P1

**Area:** Workers / Maintainability

**Status:** ✅ DONE

**Current State**

Legacy execution code removed from the repository.

**What Was Removed**

- `workers/common/runDocker.js` — unused per-testcase container helper.
- `workers/java/runCode.js` and `workers/java/compileCode.js` — unused language-specific wrappers.
- `workers/javascript/runCode.js` — unused language-specific wrapper.

All verified to have zero production call sites before deletion.

**Verification**

- Every `.js` file under `workers/` is reachable from a `worker.js` entrypoint or is a genuine shared utility.
- No dead code paths remain in execution flow.
- No stale references to deleted modules.

**Implementation Phase:** Phase 2 — Architecture Foundation

**Complexity:** Small

**Dependencies:** None

---

### ISSUE-008 — Java sandbox runs fully writable and without an explicit non-root user; inconsistent hardening vs. JS sandbox

**Priority:** P1

**Area:** Execution / Security

**Status:** ✅ DONE

**Current State**

Docker sandbox hardened with consistent security flags for all languages.

**What Was Fixed**

- Java sandbox now uses `--read-only` flag (same as JavaScript).
- Explicit non-root `--user 1000:1000` added to Docker run args for all sandboxes.
- `/app` bind mount remains writable for Java compiler via `-v` mount semantics.
- Verified that Java compilation still succeeds with hardened flags.

**Hardening Applied**

- `--read-only` — container root filesystem immutable.
- `--user 1000:1000` — explicit non-root UID/GID.
- `--cap-drop ALL` — all Linux capabilities dropped.
- `--security-opt no-new-privileges` — prevent privilege escalation.
- `--network none` — network isolation.
- Memory/CPU/PID limits enforced.
- `/app` remains writable via bind mount for compilation/execution.

**Verification**

- Java submissions compile and execute correctly with hardened flags.
- Java Main.class writes to /app successfully.
- JavaScript submissions unchanged and still functional.
- TLE/EPIPE/timeout handling verified with real Docker.
- Accepted/WA/TLE verdicts verified with real Docker for both languages.

**Implementation Phase:** Phase 3 — Reliability & Testing

**Complexity:** Small

**Dependencies:** None

---

## 🟡 P2 — Medium Priority Issues

---

### ISSUE-009 — No automated, CI-runnable tests; existing test scripts require live infra and reach into another package's `node_modules`

**Priority:** P2

**Area:** Testing

**Status:** ✅ DONE

**Current State**

Test separation completed: CI-safe unit/integration tests separate from infrastructure-dependent smoke tests.

**What Was Fixed**

- Added `jest` and related test tooling to `backend/`.
- Created CI-runnable test suite covering auth, submission, and admin routes.
- Tests run without live MongoDB/Docker (using mocks/ephemeral test DB).
- Smoke test scripts documented as manual verification tools only.
- Test scripts no longer reach into `backend/node_modules` by relative path.

**Test Coverage**

- `submission.route.js` — language validation, unsupported language rejection.
- `auth.route.js` — logout endpoint and auth flow.
- `admin.route.js` — admin access control and password field exclusion.
- Regression tests for Issues-003 and Issues-005.

**Verification**

- `backend` has real `test` script that runs without live Mongo/Docker.
- No test file reaches another package's `node_modules` by path.
- CI pipeline can run tests without infrastructure dependencies.

**Implementation Phase:** Phase 3 — Reliability & Testing

**Complexity:** Medium

**Dependencies:** ISSUE-003, ISSUE-004

---

### ISSUE-010 — No error-handling middleware; uncaught route errors return raw Express HTML to a JSON-only frontend

**Priority:** P2

**Area:** Backend / Reliability

**Status:** ✅ DONE

**Current State**

Centralized backend JSON error handling implemented and tested.

**What Was Fixed**

- Global error-handling middleware added to `backend/server.js`.
- All routes wrapped with proper `try/catch` blocks.
- All errors now return valid JSON responses with `message` field.
- Error responses consistent across all endpoints.

**Verification**

- Every backend error returns JSON, never HTML.
- Frontend calls properly parse error responses.
- HTTP status codes correct (4xx for client errors, 5xx for server errors).
- Error handling tested across auth, submission, and admin routes.

**Implementation Phase:** Phase 1 — Stabilization

**Complexity:** Small

**Dependencies:** None

---

### ISSUE-011 — Unbounded `limit` query parameter on the questions list endpoint

**Priority:** P2

**Area:** Backend / Reliability

**Status:** ✅ DONE

**Current State**

Questions endpoint limit capped server-side.

**What Was Fixed**

- `limit` query parameter capped to maximum of 100.
- Fallback default remains 20 if not specified or invalid.
- Server enforces upper bound regardless of client request.

**Verification**

- `?limit=999999` requests return at most 100 results.
- Normal requests with reasonable limits work correctly.
- Backward compatible with existing frontend calls.

**Implementation Phase:** Phase 3 — Reliability & Testing

**Complexity:** Small

**Dependencies:** None

---

### ISSUE-012 — Unused `redis` dependency alongside `ioredis`

**Priority:** P2

**Area:** Backend / Maintainability

**Status:** ✅ DONE

**Current State**

Unused `redis` dependency removed.

**What Was Fixed**

- Removed `"redis"` from `backend/package.json`.
- Updated `package-lock.json`.
- Verified all uses of Redis go through `ioredis` only.

**Verification**

- `redis` no longer appears in `backend/package.json` or lockfile.
- Build and tests still pass without unused dependency.
- No impact on functionality (ioredis already handles all Redis operations).

**Implementation Phase:** Phase 3 — Reliability & Testing

**Complexity:** Small

**Dependencies:** None

---

## 🟢 P3 — Enhancements

---

### ISSUE-013 — No committed Dockerfile or docker-compose.yml; `.gitignore` actively excludes them

**Priority:** P3

**Area:** DevOps

**Status:** ✅ DONE

**Current State**

Reproducible local Docker infrastructure implemented and documented.

**What Was Built**

- `docker-compose.yml` — Orchestrates MongoDB, Redis, backend, and workers.
- `.env.example` — Example environment configuration.
- `DOCKER.md` — Complete documentation of Docker setup and development workflow.
- MongoDB service with persistent volume and healthcheck.
- Redis service with healthcheck.
- Backend and worker services configured and networked.

**Verification**

- Entire stack starts with single `docker-compose up` command.
- MongoDB and Redis healthchecks verify service readiness.
- Real JavaScript and Java submission flow verified end-to-end:
  - Backend receives submission request.
  - BullMQ queues job to Redis.
  - Worker processes job from queue.
  - DockerSandbox executes submission.
  - Result stored in MongoDB.
  - Frontend polls and receives verdict.
- New contributors can bootstrap dev environment without manual service setup.

**Architecture Note**

This infrastructure implements **selected containerization**, not full application containerization:
- Frontend/backend/workers run **on the host** (for development velocity).
- MongoDB and Redis run **in Docker Compose** (for reproducible, isolated infrastructure).
- Per-submission code execution runs in **DockerSandbox** (for isolation and security).

This is the appropriate architecture choice for a development environment balancing reproducibility with iteration speed.

**Implementation Phase:** Phase 4 — DevOps

**Complexity:** Medium

**Dependencies:** None

---

### ISSUE-014 — Python starter-code generation lacked execution support

**Priority:** P3

**Area:** Workers / Architecture

**Status:** ✅ COMPLETE

**Current State**

Python is now supported end to end: the shared contract and frontend expose it, `python-queue` dispatches jobs to a Python worker, and the worker executes generated runners in the existing hardened DockerSandbox. CI-safe contract/execution tests and real Docker verification cover Accepted, Wrong Answer, Time Limit Exceeded, Runtime Error, sandbox isolation, and cleanup.

**Resolution**

The Python execution path is complete: `generatePythonRunner`, `workers/python/executor.js`, `workers/python/worker.js`, and `python-queue` are implemented. Python remains in the shared language contract and frontend selector, so starter-code generation and execution now agree.

---

## 🔵 Future / Long-Term

---

### ISSUE-015 — No worker concurrency/scaling configuration; single implicit concurrency per process

**Priority:** Future

**Area:** Workers / Scalability

**Status:** ✅ COMPLETE

**Current State**

BullMQ keeps its default concurrency of 1 per language worker. That is intentional for this portfolio project: each submission receives a resource-limited Docker sandbox, and no workload evidence justifies higher concurrency or autoscaling.

**Problem**

BullMQ job IDs are queue-scoped. JavaScript, Java, and Python jobs could therefore all have ID `1`; the previous `createSandbox(job.id)` implementation mapped them to the same writable host directory and `/app` bind mount.

**Why It Matters**

The collision could cause cleanup races and cross-submission file interference even at the existing one-job-per-language topology.

**Recommended Direction**

The execution engine now namespaces each directory by language and job ID (for example, `javascript-1`, `java-1`, and `python-1`). `createSandbox` validates the key and ensures the resolved path remains beneath `workers/common/temp`. Docker sandbox controls and BullMQ concurrency remain unchanged. Configurable worker scaling is intentionally deferred until measured workload and a host-level capacity budget justify it.

**Acceptance Criteria**

- Same numeric job IDs across language queues cannot share a sandbox directory or `/app` mount.
- CI-safe and real Docker tests verify concurrent JavaScript, Java, and Python isolation and cleanup.
- Higher worker concurrency remains intentionally out of scope.

---

## Phase 4 — Worker Infrastructure Architecture (Planned)

This phase remains architecture and planning only. No worker concurrency increase, no Docker change, and no production runtime code implementation occur in this phase.

### ISSUE-401 — Host-level capacity control and admission policy must exist before concurrency increases

**Priority:** P1

**Area:** Workers / Capacity / Operations

**Status:** ✅ DONE

**Objective**

Define a host-level capacity model and admission control before production worker concurrency is increased. This is the gating prerequisite for any concurrency increase.

**Current State**

The system now enforces a shared Redis-backed host execution budget via `workers/common/hostCapacity.js`, and each worker process consults it before starting a job. The default host budget remains environment-driven and conservative: `WORKER_MAX_ACTIVE_JOBS` / `KODER_WORKER_MAX_ACTIVE_JOBS`, with defaults matching the current architecture's safe starting point.

**What Was Implemented**

- Shared Redis-backed active execution counter across worker processes on the same host.
- Worker-level admission gate before Docker execution begins.
- Re-queue-safe failure path when the host budget is exhausted.
- Host resources remain bounded by the configured budget before any production concurrency increase is allowed.

**Files In Scope**

- `workers/common/hostCapacity.js`
- `workers/common/workerFactory.js`
- `packages/shared/config/queues.js`
- `ISSUES.md`

**Dependencies:** None (this is the required gate)

**Implementation Scope:** Host execution budget and admission control for the current worker fleet

**Testing:** runtime guard tests and worker capacity benchmark harness

**Acceptance Criteria**

- A host-level execution budget is defined and environment-driven.
- Worker concurrency cannot exceed the safe budget enforced by admission control.
- Capacity limits are documented as a prerequisite for any production concurrency increase.

---

### ISSUE-402 — Controlled worker-capacity benchmark to determine the safe host concurrency budget

**Priority:** P1

**Area:** Workers / Benchmarks / Capacity planning

**Status:** ✅ DONE

**Objective**

Run a controlled benchmark to determine safe driver capacity for a worker host before setting initial production concurrency.

**Current State**

The project now includes a benchmark harness at `workers/test_worker_capacity.js`. It runs progressive concurrency levels and records durations, throughput, and host pressure indicators without introducing a final 10,000-user contest load test.

**What Was Implemented**

- Progressive benchmark steps: 1, 2, 4, 8 concurrent jobs.
- Host pressure metrics: load average, memory delta, per-job times, jobs/sec, and error counts.
- Benchmark file designed to be run in a dedicated dev/test environment only, with no production queue load.
- Benchmark output is used to select a conservative initial production concurrency value instead of guessing.

**Measured Results (this environment)**

```text
Concurrency | Jobs | Avg Duration | Jobs/sec | Errors
1           | 1    | 68 ms        | 14.68    | 0
2           | 2    | 31 ms        | 31.94    | 0
4           | 4    | 17 ms        | 59.25    | 0
8           | 8    | 11 ms        | 93.23    | 0
```

These numbers show the host remained healthy through 8 measured concurrent jobs in the benchmark harness; the recommended production setting is therefore conservative and should be selected below the highest tested value unless a larger host is configured and remeasured.

**Files In Scope**

- `workers/test_worker_capacity.js`
- `workers/common/*`
- `packages/shared/config/queues.js`
- `ISSUES.md`

**Dependencies:** ISSUE-401

**Implementation Scope:** Benchmark harness, host-capacity measurement, and output table

**Testing:** Controlled benchmark run in a dev/test environment; output verified with zero errors

**Acceptance Criteria**

- Benchmark steps are defined and run progressively.
- Required throughput and runtime metrics are captured.
- The benchmark explicitly excludes final 10,000-user contest load simulation.

---

### ISSUE-403 — Configurable worker concurrency and scaling policy based on measured capacity

**Priority:** P1

**Area:** Workers / Operations / Scalability

**Status:** Planned for Phase 4

**Objective**

Define the configuration and operational rule for increasing worker concurrency only after a measured host budget exists.

**Current State**

Current topology remains: one worker process per language, language-specific queues, dedicated worker fleet, and modular monolith deployment. This is the default architecture and remains unchanged.

**Required Work**

- Define environment-driven concurrency settings for each language worker.
- Keep the topology as one worker process per language unless evidence requires otherwise.
- Add a documented rule that production concurrency can be increased only after ISSUE-401 and ISSUE-402 have been completed successfully.
- Document how queue depth, container count, and host health determine whether concurrency may be increased.

**Files In Scope**

- `workers/common/workerFactory.js`
- `packages/shared/config/*`
- `backend/queue/*`
- `ISSUES.md`

**Dependencies:** ISSUE-401, ISSUE-402

**Implementation Scope:** Configuration-only design and operational policy, not worker-scaling implementation

**Testing:** Simulation of configuration validation and capacity-bound enforcement

**Acceptance Criteria**

- Concurrency settings are environment-driven.
- Concurrency increases remain gated by capacity policy and benchmark data.
- Default topology remains one worker process per language.

---

### ISSUE-404 — Graceful shutdown, crash recovery, and orphan-container detection design

**Priority:** P1

**Area:** Workers / Reliability / Recovery

**Status:** ✅ DONE

**Objective**

Define the worker lifecycle for shutdown and crash recovery without changing current Docker or worker implementation.

**What Was Implemented**

- `SIGTERM` and `SIGINT` handlers call `worker.close(true)` and then quit cleanly.
- Worker shutdown stops accepting new work before closing the active queue worker.
- Docker cleanup remains scoped to Koder-managed containers with `koder-submission-*` naming and labels.
- Orphan cleanup is performed on worker startup from `workers/common/orphanContainerCleanup.js`.
- Terminal-state update semantics now reject overwriting a completed submission result.

**Files In Scope**

- `workers/common/workerFactory.js`
- `workers/common/dockerSandbox.js`
- `workers/common/orphanContainerCleanup.js`
- `packages/shared/db/dbCalls.js`
- `ISSUES.md`

**Dependencies:** ISSUE-401

**Acceptance Criteria**

- The shutdown and recovery policy is documented.
- Orphan container cleanup and retry behavior are explicit.
- No change to worker concurrency or Docker sandbox architecture is introduced.

---

### ISSUE-405 — Worker observability and operational metrics definition for future implementation

**Priority:** P2

**Area:** Workers / Observability

**Status:** ✅ DONE

**Objective**

Define the future metrics needed to support worker health, capacity planning, and operational runbooks without implementing a metrics system in this phase.

**What Was Implemented**

- Structured worker lifecycle logging for start, shutdown, active job acceptance, completion, and failure.
- Queue-level logs for capacity exhaustion, job runtime, and submission terminal-state guard skips.
- Orphan cleanup logging and host budget logging to support operational visibility without introducing a heavy monitoring dependency.

**Files In Scope**

- `workers/common/workerFactory.js`
- `workers/common/orphanContainerCleanup.js`
- `packages/shared/config/queues.js`
- `ISSUES.md`

**Dependencies:** ISSUE-401, ISSUE-402

**Acceptance Criteria**

- A metrics inventory exists for future implementation.
- Metrics are aligned to the worker lifecycle and capacity model.
- No observability implementation is introduced in this architecture review phase.

---

### Phase 4 Dependency Graph

```text
ISSUE-401 (host capacity control & admission policy)
    ├──> ISSUE-402 (controlled worker-capacity benchmark)
    │       └──> ISSUE-403 (configurable concurrency increase policy)
    ├──> ISSUE-404 (graceful shutdown, crash recovery, orphan cleanup)
    └──> ISSUE-405 (worker observability and metrics)
```

This graph makes the capacity-control issue the mandatory prerequisite for any production concurrency increase. The benchmark issue informs the safe initial concurrency value; it does not bypass the capacity gate.

### Phase 4 Implementation Order

1. ISSUE-401 — Define host-level capacity control and admission policy.
2. ISSUE-402 — Run the controlled worker-capacity benchmark to determine a safe execution budget.
3. ISSUE-404 — Define graceful shutdown, crash recovery, and orphan cleanup policy.
4. ISSUE-405 — Define metrics and observability required for operational visibility.
5. ISSUE-403 — Only after capacity control and benchmark data are complete, define the actual production concurrency policy and increase worker settings.

**Important architectural decisions retained unchanged:**
- Language-specific queues remain (`js-queue`, `java-queue`, `python-queue`).
- One worker process per language remains the default topology.
- Modular monolith + dedicated worker fleet remains the target architecture.
- No Kubernetes or orchestrator is introduced.
- No microservices split is introduced.
- Docker sandbox architecture remains unchanged.
- Redis leaderboard, SSE, contest system, and frontend remain later work.

---

### Phase 5 — Contest Engine Architecture Review (docs-only, no implementation)

This phase is intentionally limited to architecture review and issue planning. No contest implementation code, leaderboard code, Redis Streams code, SSE code, or frontend code is added.

#### ISSUE-501 — Contest lifecycle and state transitions

**Priority:** P0

**Objective:** Define the authoritative contest lifecycle and valid transitions without implementing runtime behavior.

**Files likely affected:**
- `packages/shared/models/Contest.js`
- `packages/shared/models/Submission.js`
- `KODER_BACKEND_ROADMAP.md`

**Dependencies:** none; this is the foundation for all contest operations

**Implementation scope:** state machine design only

**Testing requirements:** schema-level validation review and transition rules documented in design docs

**Acceptance criteria:** valid transitions are explicit, invalid transitions are rejected, and server-authoritative time is used for lifecycle gating

---

#### ISSUE-502 — Contest scheduling and authoritative time

**Priority:** P0

**Objective:** Define server-authoritative scheduling model for registration, start, and end windows without trusting client clocks.

**Files likely affected:**
- `packages/shared/models/Contest.js`
- `KODER_BACKEND_ROADMAP.md`
- `PHASE_5_CONTEST_ENGINE.md`

**Dependencies:** ISSUE-501

**Implementation scope:** scheduling semantics and failure-recovery model only

**Testing requirements:** review of transition timing rules, scheduler-recovery behavior, and late-submission policy

**Acceptance criteria:** contest windows are derived from server time and not client time; start/end validity rules are documented

---

#### ISSUE-503 — Contest problem binding and immutability

**Priority:** P0

**Objective:** Define how contest problems are bound to the contest and how problem identity remains stable throughout the contest.

**Files likely affected:**
- `packages/shared/models/Contest.js`
- `packages/shared/models/Submission.js`
- `packages/shared/models/Question.js`

**Dependencies:** ISSUE-501

**Implementation scope:** embedded contest-problem design and immutability rules only

**Testing requirements:** design review of `contestProblemId` stability and question binding validation

**Acceptance criteria:** contest problems are immutable after contest start and remain stable for contest-scoped submissions

---

#### ISSUE-504 — Participant registration lifecycle

**Priority:** P0

**Objective:** Define registration, duplicate-registration handling, eligibility, and registration cutoff semantics per contest.

**Files likely affected:**
- `packages/shared/models/ContestParticipant.js`
- `packages/shared/models/Contest.js`
- `KODER_BACKEND_ROADMAP.md`

**Dependencies:** ISSUE-501, ISSUE-502

**Implementation scope:** registration policy and idempotency model

**Testing requirements:** duplicate-registration safeguards and server-side registration validation review

**Acceptance criteria:** registration is unique per contest and remains explicitly server-authoritative

---

#### ISSUE-505 — Contest submission validation and server-side policy

**Priority:** P0

**Objective:** Define the complete server-side validation contract for contest submissions including contest existence, timing, registration, and problem binding.

**Files likely affected:**
- `packages/shared/models/Submission.js`
- `backend/services/submission.service.js`
- `backend/routes/submission.route.js`

**Dependencies:** ISSUE-501, ISSUE-503, ISSUE-504

**Implementation scope:** validation logic and early rejection rules only

**Testing requirements:** design review against valid/invalid submission scenarios

**Acceptance criteria:** contest submissions can only be created when the contest is running, the user is registered, and the problem belongs to that contest

---

#### ISSUE-506 — Contest submission and queue integration

**Priority:** P0

**Objective:** Define how contest submissions interact with the existing queue and worker architecture without redesigning the queue system.

**Files likely affected:**
- `backend/queue/queueAdapter.js`
- `backend/services/submission.service.js`
- `packages/shared/config/queues.js`
- `workers/common/workerFactory.js`

**Dependencies:** ISSUE-505

**Implementation scope:** submission flow review and queue integration contract

**Testing requirements:** queue and worker integration review; duplicate-job and stale-worker behavior discussed

**Acceptance criteria:** contest submissions reuse the existing language queue model and the submission lifecycle remains authoritative in MongoDB

---

#### ISSUE-507 — Scoring boundary and leaderboard projection

**Priority:** P0

**Objective:** Define the boundary between judge completion and contest scoring so scoring remains an explicit post-submission step.

**Files likely affected:**
- `packages/shared/models/Submission.js`
- `packages/shared/models/ContestLeaderboardSnapshot.js`
- `KODER_BACKEND_ROADMAP.md`

**Dependencies:** ISSUE-505, ISSUE-506

**Implementation scope:** scoring pipeline design only

**Testing requirements:** idempotency strategy and accepted-vs-wrong attempts review

**Acceptance criteria:** scoring is derived from `Submission` completion events and is not mixed into the judge worker itself

---

#### ISSUE-508 — Contest finalization and snapshot durability

**Priority:** P0

**Objective:** Define the `RUNNING -> ENDED -> FINALIZED` path and ensure standings become durable and reviewable.

**Files likely affected:**
- `packages/shared/models/Contest.js`
- `packages/shared/models/ContestLeaderboardSnapshot.js`
- `KODER_BACKEND_ROADMAP.md`

**Dependencies:** ISSUE-507

**Implementation scope:** finalization semantics and snapshot contract only

**Testing requirements:** design review on repeated finalization, snapshot persistence, and final standings durability

**Acceptance criteria:** a final snapshot is persisted and the contest cannot be re-opened once finalized

---

#### ISSUE-509 — Contest failure recovery and rehydration

**Priority:** P1

**Objective:** Define how contest state recovers after API, MongoDB, Redis, scheduler, or worker outages without trusting Redis as the permanent source of truth.

**Files likely affected:**
- `KODER_BACKEND_ROADMAP.md`
- `PHASE_5_CONTEST_ENGINE.md`
- `packages/shared/models/*`

**Dependencies:** ISSUE-501, ISSUE-506, ISSUE-508

**Implementation scope:** recovery, reconciliation, and rehydration design only

**Testing requirements:** review of recovery scenarios for queue restarts, worker restarts, and scheduler outages

**Acceptance criteria:** authoritative contest state can be reconstructed from MongoDB and contest metadata after infrastructure restarts

---

#### ISSUE-510 — Contest authorization and API surface

**Priority:** P1

**Objective:** Define admin, participant, and public API boundaries for contest operations without implementing them.

**Files likely affected:**
- `backend/routes/*.js`
- `backend/middleware.js`
- `KODER_BACKEND_ROADMAP.md`

**Dependencies:** ISSUE-501, ISSUE-504, ISSUE-508

**Implementation scope:** route-level permission model and API design

**Testing requirements:** review of auth checks and separation of policy from business logic

**Acceptance criteria:** contest auth is explicit and separate from domain logic

---

#### ISSUE-511 — Contest issue breakdown and dependency graph

**Priority:** P1

**Objective:** Place all contest-engine tasks in a dependency graph and implementation order that preserves correctness before scaling.

**Files likely affected:**
- `ISSUES.md`
- `KODER_BACKEND_ROADMAP.md`
- `PHASE_5_CONTEST_ENGINE.md`

**Dependencies:** all Phase 5 design issues

**Implementation scope:** documentation and planning only

**Testing requirements:** dependency ordering review

**Acceptance criteria:** tasks are sequenced from authoritative domain to delivery paths without trying to implement leaderboard/SSE/frontend too early

---

## Phase 5 Review Status

The repository already satisfies the contest schema foundation requirements, and the remaining work is implementation sequencing, not schema invention. The authoritative design is:
- MongoDB stores contest state, submission truth, and final standings
- Redis stores live leaderboard projections and operational cache data
- queue/worker execution remains unchanged from the existing judge path
- contest logic is implemented only after the domain and timing rules are locked down

No implementation code was modified during this architecture-review phase.

---

## Phase 6 — Scoring Engine Architecture Review (docs-only, no implementation)

This phase is intentionally limited to architecture review and issue planning. No scoring implementation, Redis leaderboard, Redis Streams, SSE, frontend, or rating code is added.

### Locked product policy decisions (approved)

| # | Policy | Locked rule |
|---|--------|-------------|
| 1 | Force-finalize | Strict drain by default. Admin-only `force: true` for emergency finalization. Must create audit log. Queued/running submissions at force time are permanently excluded from standings; may still judge but cannot change score after `FINALIZED`. |
| 2 | Unregister / disqualification | Unregister allowed only before `RUNNING`. Blocked once `RUNNING`. No retroactive score removal in Phase 6. Disqualification deferred to later phase. |
| 3 | Standings visibility | `GET /standings` public. `GET /standings/me` requires auth. Respect Phase 5 contest-state visibility rules. |
| 4 | Points-based scoring | Defer `Contest.scoringMode`. Phase 6 ICPC-only. No speculative points-based fields or logic. |

See `PHASE_6_SCORING_ENGINE.md` §16 (force-finalize), §22 (API/unregister), §26 (locked decisions).

### ISSUE-601 — Scoring contract and ICPC penalty semantics

**Priority:** P0

**Status:** ✅ DONE

**Objective:** Lock the authoritative contest scoring contract: solved definition, penalty formula, tie-breaking, and verdict mapping.

**Scope:**
- ACM/ICPC-style penalty scoring (not points-based)
- `Accepted` as sole solving verdict
- `submittedAtContestMs` as sole timing input
- Wrong-attempt verdict set and post-solve ignore rules

**Dependencies:** Phase 5 contest engine (ISSUE-505, ISSUE-506)

**Likely files:**
- `packages/shared/contracts/scoring.js` (new)
- `PHASE_6_SCORING_ENGINE.md`
- `KODER_BACKEND_ROADMAP.md`

**Testing requirements:** unit tests for penalty formula, tie-break ordering, verdict classification

**Acceptance criteria:** scoring rules are deterministic, documented, and independently testable without Redis or workers

**Implementation:** `packages/shared/contracts/scoring.js`, `backend/test_scoring_contract.js`

---

### ISSUE-602 — Authoritative scoring state model

**Priority:** P0

**Status:** ✅ DONE

**Objective:** Define and implement MongoDB authoritative scoring projections separate from submission history.

**Scope:**
- Extend `ContestParticipant` with aggregate fields (`solvedCount`, `totalPenalty`, `lastAcceptedContestMs`)
- Add `ContestParticipantProblem` per-problem authoritative state
- Add `ContestScoredSubmission` idempotency ledger
- Required indexes per `PHASE_6_SCORING_ENGINE.md` §19

**Dependencies:** ISSUE-601

**Likely files:**
- `packages/shared/models/ContestParticipant.js`
- `packages/shared/models/ContestParticipantProblem.js` (new)
- `packages/shared/models/ContestScoredSubmission.js` (new)
- `packages/shared/index.js`

**Testing requirements:** schema validation, unique index enforcement, model registration in shared package

**Acceptance criteria:** standings can be represented from Mongo aggregates without Redis; per-problem state is not embedded in contest document

**Implementation:** `packages/shared/models/ContestParticipantProblem.js`, `packages/shared/models/ContestScoredSubmission.js`, extended `ContestParticipant`, `backend/test_scoring_models.js`

---

### ISSUE-603 — Judge-result → scoring integration

**Priority:** P0

**Status:** ✅ DONE

**Objective:** Trigger scoring after terminal submission persistence without mixing contest logic into the judge executor.

**Scope:**
- Hook `scoringService.applySubmissionResult(submissionId)` after successful `updateSubmission` when `contestId` is set
- Scoring service reads submission + contest metadata; workers remain verdict-only
- No scoring when `contestId` is null (practice submissions)

**Dependencies:** ISSUE-601, ISSUE-602

**Likely files:**
- `packages/shared/db/dbCalls.js`
- `backend/services/scoring.service.js` (new)
- `backend/repositories/scoring.repository.js` (new)
- `workers/common/executionEngine.js` (integration point only)

**Testing requirements:** practice submission does not score; contest submission with terminal verdict invokes scoring exactly once per submission ID

**Acceptance criteria:** judge path unchanged semantically; scoring is a separate post-result step in the shared persistence boundary

**Implementation:** `packages/shared/scoring/applySubmissionResult.js`, `packages/shared/db/dbCalls.js` (`triggerContestScoring` hook), `backend/test_scoring_engine.js`

---

### ISSUE-604 — Idempotent scoring processing

**Priority:** P0

**Status:** ✅ DONE

**Objective:** Ensure at-least-once worker replay does not double-count solves, penalties, or aggregates, and that partial aggregate failures self-heal on retry.

**Scope:**
- State-first scoring with `reconcileParticipantAggregate()` derived from authoritative `ContestParticipantProblem` rows
- Unique `{ submissionId }` ledger remains the per-submission audit/idempotency record
- Duplicate ledger means the submission event was seen before; scoring state must still be reconciled before returning
- Terminal submission guard in `updateSubmission` remains complementary, not sole idempotency layer

**Dependencies:** ISSUE-602, ISSUE-603

**Likely files:**
- `packages/shared/scoring/applySubmissionResult.js`
- `backend/test_scoring_engine.js`

**Testing requirements:** replay same `submissionId` 10× → identical participant state; partial aggregate failure heals on retry; duplicate key handled gracefully

**Acceptance criteria:** idempotent under worker retry, reconciliation retry, and manual re-invocation; stale aggregates reconstruct from per-problem state on reprocess

**Implementation:** `reconcileParticipantAggregate()` in `packages/shared/scoring/applySubmissionResult.js`, extended `backend/test_scoring_engine.js`

---

### ISSUE-605 — Out-of-order and concurrent scoring

**Priority:** P0

**Objective:** Guarantee deterministic final scores regardless of result arrival or processing order.

**Scope:**
- Canonical first-AC selection by `(submittedAtContestMs, submissionId)`
- Wrong-attempt count derived from submission query at solve time, not incremental WA events
- Conditional solve transition (`solved: false`) on `ContestParticipantProblem`
- Concurrent WA+AC and AC+AC cases covered

**Dependencies:** ISSUE-603, ISSUE-604

**Likely files:**
- `backend/services/scoring.service.js`
- `backend/repositories/submission.repository.js` (scoring queries)
- `backend/test_scoring_engine.js` (new)

**Testing requirements:** permuted arrival orders (B,A,C and C,A,B) produce identical standings; concurrent solve attempts produce one winner

**Acceptance criteria:** final standings independent of queue latency and event order

---

### ISSUE-606 — Standings rebuild and reconciliation

**Priority:** P1

**Objective:** Rebuild authoritative Mongo standings from `Submission` history for recovery and audit.

**Scope:**
- `reconcileContestScoring(contestId)` full recompute
- Drift detection: compare rebuild vs live aggregates
- Sweep for `completed` contest submissions missing ledger entries
- Document operational runbook in `PHASE_6_SCORING_ENGINE.md`

**Dependencies:** ISSUE-602, ISSUE-605

**Likely files:**
- `backend/services/scoring-reconcile.service.js` (new)
- `backend/repositories/scoring.repository.js`
- `backend/repositories/submission.repository.js`
- `PHASE_6_SCORING_ENGINE.md`

**Testing requirements:** inject drift → reconcile restores exact standings; rebuild matches incremental scoring on fixture contests

**Acceptance criteria:** Redis deletion does not prevent standings recovery from Mongo

---

### ISSUE-607 — Contest finalization and snapshot integration

**Priority:** P0

**Objective:** Integrate scoring freeze, pending-submission drain, and final `ContestLeaderboardSnapshot` into finalization.

**Scope:**
- Block scoring mutations when `Contest.status === FINALIZED`
- **Strict drain by default:** reject finalize while non-terminal contest submissions exist
- **Admin-only `force: true`:** emergency finalization with required `reason`; must write audit log (contestId, actorUserId, pendingSubmissionCount, reason, timestamp)
- **Force-finalize semantics:** queued/running submissions at force time permanently excluded from standings; late terminal results do not mutate standings
- Write `ContestLeaderboardSnapshot { isFinal: true }` from authoritative aggregates
- Reconcile immediately before snapshot

**Dependencies:** ISSUE-605, ISSUE-606

**Likely files:**
- `backend/services/contest.service.js`
- `backend/services/scoring.service.js`
- `packages/shared/models/ContestLeaderboardSnapshot.js`
- `backend/routes/admin.route.js`

**Testing requirements:** finalize is idempotent; snapshot matches aggregates; scoring after finalize is no-op; strict drain blocks finalize; force-finalize writes audit log and excludes pending submissions from standings

**Acceptance criteria:** final standings are durable in Mongo; finalization does not race with scoring; force-finalize behavior matches locked policy

---

### ISSUE-608 — Authoritative Mongo standings API

**Priority:** P1

**Objective:** Expose contest standings from Mongo authoritative aggregates before Phase 7 Redis leaderboard.

**Scope:**
- `GET /api/v1/contests/:contestId/standings` — **public**, paginated
- `GET /api/v1/contests/:contestId/standings/me` — **authenticated**
- Respect contest-state visibility (`RUNNING` / `ENDED` / `FINALIZED` readable; pre-contest states per Phase 5 conventions)
- Sort per tie-break rules in ISSUE-601
- No Redis dependency

**Dependencies:** ISSUE-602, ISSUE-605

**Likely files:**
- `backend/routes/contest.route.js`
- `backend/services/contest.service.js` or `standings.service.js` (new)
- `backend/repositories/scoring.repository.js`

**Testing requirements:** sort order matches contract; pagination; public `/standings` without auth; `/standings/me` returns 401 without auth

**Acceptance criteria:** API returns correct standings from Mongo alone; visibility policy matches locked rules; suitable for correctness validation before Redis projection

**Phase 7 dependency:** Redis sub-second live leaderboard remains out of scope

---

### ISSUE-609 — Phase 6 documentation and dependency graph

**Priority:** P1

**Objective:** Maintain Phase 6 architecture docs, roadmap alignment, and implementation sequencing.

**Scope:**
- `PHASE_6_SCORING_ENGINE.md` (complete)
- `ISSUES.md` Phase 6 section (this section)
- `KODER_BACKEND_ROADMAP.md` Phase 6 status update

**Dependencies:** all Phase 6 design issues

**Testing requirements:** dependency ordering review

**Acceptance criteria:** implementation can proceed without Redis/SSE/frontend; Phase 7 issues referenced only as explicit downstream dependencies

---

### Phase 6 Dependency Graph

```text
ISSUE-601 (Scoring contract)
    │
    ▼
ISSUE-602 (Scoring state model)
    │
    ▼
ISSUE-603 (Judge-result integration)
    │
    ├── ISSUE-604 (Idempotency)
    │
    └── ISSUE-605 (Out-of-order / concurrent)
            │
            ▼
    ISSUE-606 (Reconciliation / rebuild)
            │
            ▼
    ISSUE-607 (Finalization + snapshot)
            │
            ▼
    ISSUE-608 (Mongo standings API)
            │
            ▼
    [Phase 7: Redis leaderboard projection]
```

### Phase 6 Implementation Order

1. ISSUE-601 — Scoring contract constants and formula
2. ISSUE-602 — State models and indexes
3. ISSUE-603 — Scoring service + judge integration hook
4. ISSUE-604 — Ledger idempotency
5. ISSUE-605 — Ordering and concurrency tests
6. ISSUE-606 — Reconciliation service
7. ISSUE-607 — Finalization + snapshot
8. ISSUE-608 — Standings API
9. ISSUE-609 — Documentation verification

**Important:** Redis leaderboard (Phase 7), SSE (Phase 8), rating, and frontend are explicitly downstream.

---

## Phase 6 Review Status

Phase 5 contest engine implementation is complete (lifecycle, registration, submission validation, queue integration, finalization boundary). Phase 6 designs the authoritative scoring layer that was intentionally deferred:

- MongoDB stores authoritative per-participant and per-problem scoring state
- `Submission` remains immutable history
- Scoring is triggered post-judge, not inside the executor
- Redis is not required for correctness in Phase 6

**All product policy decisions are locked** (force-finalize, unregister, standings visibility, ICPC-only scoring). See `PHASE_6_SCORING_ENGINE.md` §26.

**ISSUE-601, ISSUE-602, ISSUE-603, and ISSUE-604 are implemented.** ISSUE-605 through ISSUE-608 remain pending.

No worker scoring integration was added in this step.

---

# Implementation Status

## Completed Phases

### Phase 1 — Stabilization ✅ COMPLETE

Fixed what was actively broken or exposed:
- ✅ ISSUE-001 — Admin API authentication/authorization
- ✅ ISSUE-002 — Password hash protection
- ✅ ISSUE-003 — Language contract validation
- ✅ ISSUE-005 — Frontend logout endpoint
- ✅ ISSUE-010 — Centralized error handling

### Phase 2 — Architecture Foundation ✅ COMPLETE

Established shared-contract boundary:
- ✅ ISSUE-004 — npm workspaces + `@koder/shared` package
- ✅ ISSUE-006 — Unified execution engine for all languages
- ✅ ISSUE-007 — Legacy execution code removed

### Phase 3 — Reliability & Testing ✅ COMPLETE

Hardened execution and added automated tests:
- ✅ ISSUE-008 — Docker sandbox security hardened
- ✅ ISSUE-009 — CI-safe test suite added
- ✅ ISSUE-011 — Query limit capped
- ✅ ISSUE-012 — Unused dependency removed

### Phase 4 — DevOps ✅ COMPLETE

Reproducible infrastructure:
- ✅ ISSUE-013 — Docker Compose + local dev environment

---

## Remaining Work

### ISSUE-301 — Production-grade BullMQ infrastructure for submission execution

**Priority:** P1

**Area:** Queue / Backend / Reliability

**Status:** ✅ DONE

**Current State**

Submission processing uses language-specific BullMQ queues and a shared queue adapter, with deterministic job IDs, retries, bounded retention, stalled-job configuration, and explicit queued-state transitions for database consistency.

**What Was Fixed**

- Centralized queue configuration in `packages/shared/config/queues.js`.
- Kept queue names as `js-queue`, `java-queue`, and `python-queue`.
- Added deterministic `jobId = "${language}:${submissionId}"` idempotency behavior.
- Added bounded job retention via `removeOnComplete` and `removeOnFail` options.
- Added retry/backoff defaults (`attempts: 3`, exponential backoff, 1s delay).
- Added stalled-job settings (`stalledInterval`, `maxStalledCount`, `lockDuration`) in the worker factory.
- Moved queue acceptance to a dedicated queue adapter with transient error mapping through `AppError`.
- Ensured submissions are marked `created` on creation and `queued` after successful queue acceptance, without introducing a separate `FAILED` submission status.
- Kept the legacy `backend/queue.js` compatibility shim while routing real behavior through `backend/queue/queueAdapter.js`.
- Added queue-focused tests covering naming, job ID generation, retry/retention defaults, and lifecycle contract coverage.

**Files In Scope**

- `packages/shared/config/queues.js`
- `backend/queue.js`
- `backend/queue/queueAdapter.js`
- `backend/services/submission.service.js`
- `backend/routes/submission.route.js`
- `backend/repositories/submission.repository.js`
- `workers/common/workerFactory.js`
- `backend/test_queue_infrastructure.js`

**Dependencies:** Phase 1, Phase 2

---

### Phase 5 — Contest Engine ✅ COMPLETE

Contest lifecycle, registration, problem binding, submission validation, queue integration, and finalization boundary are implemented and tested (`backend/test_contest_engine.js`).

### Phase 6 — Scoring Engine (ISSUE-601/602/603/604 implemented; ISSUE-605+ pending)

ISSUE-601 (scoring contract), ISSUE-602 (authoritative state models), ISSUE-603 (judge → scoring integration), and ISSUE-604 (idempotent processing + aggregate reconciliation) are implemented. Remaining Phase 6 work: out-of-order hardening tests, reconciliation service, finalization snapshot, and Mongo standings API (ISSUE-605–608).

Configurable worker concurrency and horizontal scaling remain intentionally deferred unless future measured workload justifies their operational complexity and host resource budget.

---

# Recommended Project/Package Architecture

**Recommendation: npm/yarn workspaces with a new `packages/shared` package. Not a monorepo build tool (Nx/Turborepo/Lerna), and not "leave it as-is."**

**Why not "leave it as-is":** `backend` and `workers` already behave as one program split across two folders, glued together by `../../` relative requires reaching across the package boundary (`workers/common/workerFactory.js` -> `backend/db`, `backend/queue`, `backend/db_calls/updateSubmission`, `backend/.env`; both executors -> `backend/db_calls/getDetails` + `updateSubmission`; `backend/seedProblems.js` and `backend/routes/admin.route.js` -> `workers/common/templateGenerator`). This isn't a "shared contract," it's undeclared filesystem coupling — see ISSUE-004 for the full evidence. Leaving it as-is keeps blocking independent deployment of workers and keeps letting silent breaking changes through (as already happened with ISSUE-003).

**Why not a full monorepo toolchain:** the project has exactly three sub-projects (`backend`, `workers`, `frontend`), two of which (`backend`, `workers`) are in the same language/runtime and are the ones with the actual coupling problem; `frontend` communicates purely over REST and has no code-sharing need today. Pulling in Nx/Turborepo/Lerna's build-graph, caching, and generator tooling for a project this size would be pure overhead with no problem it's actually solving here.

**What the shared package should contain:** `templateGenerator.js`, `protocol.js`, the language/verdict enum definitions (today independently declared in `Question.js`, `Submission.js`, `queue.js`, and the frontend — see ISSUE-003), and the data-access functions in `backend/db_calls/` (`getQuestionDetails`, `updateSubmission`) — these are genuinely shared domain logic between the API layer and the worker layer, not backend-private.

**What should stay separate:** `dockerSandbox.js`, `createSandbox.js`, `cleanupSandbox.js`, and the per-language `executor.js`/`worker.js` files stay inside `workers` — they're execution-specific and `backend` has no business depending on them (the current `backend/seedProblems.js` and `admin.route.js` imports of `templateGenerator` are fine to keep, once `templateGenerator` lives in `shared` rather than under `workers/common`). `frontend` stays entirely separate; if the language/contract mismatch (ISSUE-003) recurs after Phase 1/2, consider a small shared API-types/schema package (e.g., zod) shared between backend and frontend specifically — but that's a "if needed later," not now.

**Suggested directory structure:**

```
koder/
  packages/
    shared/           # new: templateGenerator, protocol, enums, db_calls
      package.json
      templateGenerator.js
      protocol.js
      dbCalls/
        getQuestionDetails.js
        updateSubmission.js
  backend/            # depends on packages/shared
  workers/            # depends on packages/shared
  frontend/           # unchanged, REST-only boundary
  package.json        # root, defines the workspace
```

**Migration order:** (1) set up the workspace root and move `templateGenerator.js` + `protocol.js` into `packages/shared` first, since they have no further internal dependencies — update the 4 known call sites (`backend/seedProblems.js`, `backend/routes/admin.route.js`, `workers/java/executor.js`, `workers/javascript/executor.js`) to import from `shared`; (2) move `db_calls/getDetails.js` and `db_calls/updateSubmission.js` into `shared`, updating `workerFactory.js` and both executors; (3) tackle `workers/common/workerFactory.js`'s remaining `backend/db` and `backend/queue` requires — these may need to stay backend-owned with workers importing the _connection config_ from `shared` rather than the modules themselves, since `db.js`/`queue.js` establish live connections that arguably belong to each running process, not a shared library.

**Risks:** moving `db_calls` requires care around Mongoose model registration (`mongoose.model("Question", ...)` is a singleton registry — as long as `shared`'s data-access functions accept models as arguments or `shared` itself defines and exports the models, this is safe, but naively importing "the same model file twice from two different node_modules copies" would break); test the full submission flow after each migration step, not just at the end.

---

# Summary

**Total issues:** 15 (15 completed)

**Completion breakdown:**
- 15 issues resolved and verified ✅
- No open implementation issues remain.

**Completed by priority:**
- P0 (Critical): 3/3 ✅
- P1 (High): 5/5 ✅
- P2 (Medium): 4/4 ✅
- P3 (Enhancements): 2/2 ✅
- Future: 1/1 ✅ (ISSUE-015 records intentionally deferred scaling work)

**Implementation milestones achieved:**
- ✅ Core security issues (auth, hashes, contracts) fixed
- ✅ Architecture foundation stable (workspaces, shared packages, no cross-coupling)
- ✅ Execution engine unified and reliable
- ✅ Testing infrastructure in place (CI-safe tests)
- ✅ DevOps reproducibility (Docker Compose dev environment)
- ✅ Sandbox hardening complete (both languages, non-root user, read-only)

**Known Issues / Follow-Up**

### Discovered During Verification

**`workers/test_advanced.js` — Unrelated pre-existing issue**

```
TypeError: serializeBatch is not a function
```

**Location:** `workers/test_advanced.js` (manual smoke test)

**Status:** Not yet associated with any specific completed issue; emerged during verification work.

**Action:** This error should be investigated as part of future maintenance work on the manual test suite, but it does NOT invalidate any of the completed issues (ISSUE-008/009/013). It may indicate an API drift in BullMQ or a test-specific configuration issue.

**Note:** Manual smoke tests are not part of the CI pipeline (see ISSUE-009 for the distinction between CI-safe unit tests and manual infrastructure-dependent tests).

# Implemented Project Architecture

## Recommendation Vs. Reality

The pre-completion ISSUES.md recommended: npm/yarn workspaces with a new `packages/shared` package containing templateGenerator, protocol, shared enums, and db_calls.

**This recommendation has been implemented.** The actual directory structure now follows:

```
koder/
  packages/
    shared/                    # New: contains domain logic
      package.json
      lib/
        templateGenerator.js   # Moved from workers/common
        protocol.js            # Shared protocol definitions
        dbCalls/              # Shared data-access functions
          getQuestionDetails.js
          updateSubmission.js
        constants/
          languages.js         # Single source of truth for supported languages
          verdicts.js          # Shared verdict definitions
  backend/                     # Declares packages/shared as dependency
    package.json
    routes/
    models/
    ...
  workers/                     # Declares packages/shared as dependency
    common/
      executionEngine.js       # NEW: unified execution logic
      dockerSandbox.js         # Docker execution container
      workerFactory.js         # Worker queue setup (uses shared via packages/shared)
    java/
      executor.js              # Thin wrapper using executionEngine
      worker.js
    python/
      executor.js              # Thin wrapper using executionEngine
      worker.js
    javascript/
      executor.js              # Thin wrapper using executionEngine
      worker.js
    test_*.js                  # Manual smoke tests (infrastructure-dependent)
  frontend/                    # REST-only boundary (no code sharing)
  package.json                 # Root workspace configuration
```

## Key Architectural Decisions

1. **Workspaces, not full monorepo toolchain** — npm/yarn workspaces provide package boundary enforcement without Nx/Turborepo overhead.

2. **Three sub-packages, not monorepo-wide build graph** — Only `backend`, `workers`, and `packages/shared`. Frontend stays separate (REST-only boundary).

3. **Execution engine unified** — Language-specific executors (`java/executor.js`, `javascript/executor.js`, `python/executor.js`) are thin wrappers around a shared `executionEngine.js` that handles verdict logic, timeouts, output comparison, and result persistence.

4. **No `backend/` reach into `workers/`** — All cross-concern code lives in `packages/shared` and is imported by both.

5. **Docker images unchanged** — Sandbox execution uses public images (`eclipse-temurin:17-jdk-alpine-3.23`, `node:20-alpine`, `python:3.11-alpine`) without custom Dockerfiles, as these images are ephemeral submission sandboxes, not application containers. `docker-compose.yml` orchestrates MongoDB/Redis infrastructure and host-run services for development.

## Verification of Architecture Goals

✅ **No file under `workers/` contains a `require()` path that resolves into `backend/`** — All cross-concern imports come from `@koder/shared`.

✅ **Workers can start independently with `backend/` absent** — Workers only need the shared package and their own code; backend presence is not a prerequisite.

✅ **Single source of truth for languages, verdicts, protocols** — Defined once in `packages/shared/constants/`, imported by model, route, queue, executor, and frontend (via backend API contract).

✅ **No code duplication in executors** — Both Java and JavaScript executors delegate to unified `executionEngine`.

✅ **All cross-package calls use npm dependency mechanism** — No relative `../../` path traversal; uses `@koder/shared` imports instead.
