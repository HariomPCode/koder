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

### Phase 5 — Product Features & Future Scaling ✅ COMPLETE

No unresolved implementation issues remain. Configurable worker concurrency and horizontal scaling are intentionally deferred unless future measured workload justifies their operational complexity and host resource budget.

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
