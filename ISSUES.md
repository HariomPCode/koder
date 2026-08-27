# Engineering Roadmap

This document tracks verified engineering issues found in the `koder` codebase (backend, workers, frontend), based on a direct read of the repository source (uploaded as a ZIP snapshot). Every issue below is grounded in code that was actually inspected — file paths are cited under "Evidence" for each. Use the priority sections to triage day-to-day work, and the "Recommended Implementation Order" at the end to sequence larger efforts; issues are linked via `Dependencies` where one blocks or informs another.

## 🔴 P0 — Critical Issues

---

### ISSUE-001 — Admin API is completely unauthenticated

**Priority:** P0

**Area:** Security / Backend

**Status:** Done

**Current State**

`backend/server.js` mounts the admin router with no auth guard: `app.use("/admin", adminRoute)`. `backend/routes/admin.route.js` itself never imports or applies `middleware.js` (the JWT-checking middleware used everywhere else, e.g. in `user.route.js` and `submission.route.js`).

**Problem**

Every admin endpoint is reachable by any unauthenticated client: `GET /admin/users` (returns full `User` documents — see Issue-002), `GET /admin/questions` and `GET /admin/questions/:questionId` (return full `Question` docs including `hiddenTestCases`), and `POST` / `PUT` / `DELETE /admin/questions` (create, edit, delete problems).

**Why It Matters**

Anyone can dump the user table, read every problem's hidden test cases (defeats the entire judging model — hidden cases become non-hidden), or delete/overwrite problems in production. This is the single highest-impact issue in the repo.

**Evidence**

- `backend/server.js:24` — `app.use("/admin", adminRoute);` with no middleware argument.
- `backend/routes/admin.route.js:1-157` — no `require("../middleware")` anywhere in the file; all 6 routes (`/users`, `/questions` GET/POST, `/questions/:questionId` GET/PUT/DELETE) are open.

**Recommended Direction**

Apply the existing `middleware.js` (or a stricter admin-role check, since `middleware.js` currently only checks "is a logged-in user," not "is an admin") to the whole `admin.route.js` router before it's mounted. At minimum this requires adding an `isAdmin` flag to the `User` model and checking it; simplest fix is `router.use(middleware)` plus a role check inside each handler or a small `requireAdmin` middleware.

**Acceptance Criteria**

- All `/admin/*` routes return 401/403 without a valid admin-flagged session.
- `hiddenTestCases` are never returned from any endpoint reachable by a non-admin, authenticated request.

**Complexity:** Small

**Dependencies:** None

---

### ISSUE-002 — `/admin/users` returns full user documents including password hashes

**Priority:** P0

**Area:** Security / Backend

**Status:** Done

**Current State**

`router.get("/users", ...)` in `backend/routes/admin.route.js:8-12` runs `User.find({})` with no field projection and returns the raw array as `{ users }`.

**Problem**

Unlike `user.route.js:12-14`, which explicitly does `.select({ password: 0 })`, this admin route has no projection at all, so the bcrypt `password` field is included in the JSON response for every user.

**Why It Matters**

Combined with Issue-001 (no auth on this route), this means bcrypt hashes for every account are publicly downloadable, enabling offline password cracking.

**Evidence**

- `backend/routes/admin.route.js:8-12`
- Compare `backend/routes/user.route.js:12-14` for the correct pattern already used elsewhere in the same codebase.

**Recommended Direction**

Add `.select({ password: 0 })` (or an explicit inclusion list) to the admin `/users` query, in addition to fixing Issue-001. Both are needed — auth fixes _who_ can call it, projection fixes _what_ it leaks even to a legitimate admin's browser/logs.

**Acceptance Criteria**

- `/admin/users` response never contains a `password` field, verified by a test.

**Complexity:** Small

**Dependencies:** ISSUE-001

---

### ISSUE-003 — Language contract is inconsistent across model, route, queue, and frontend, causing silently-stuck or crashing submissions

**Priority:** P0

**Area:** Architecture / Backend / Workers / Frontend

**Status:** Done

**Current State**

Four different places define "which languages exist," and they don't agree:

- `backend/models/Question.js:51` — `starterCode.language` enum: `["javascript", "java", "python", "cpp"]` (4 languages).
- `backend/models/Submission.js:24` — `language` enum: `["javascript", "java", "cpp"]` (3 languages — no `python`).
- `backend/routes/submission.route.js:32-40` — job dispatch only branches on `"javascript"` and `"java"`; there is no `else` branch, so any other value (including the schema-valid `"cpp"`) leaves `job` as `undefined` and never enqueues anything.
- `backend/queue.js:10-11` — only `jsQueue` and `javaQueue` exist; there is no `cppQueue`.
- `frontend/app/problems/[slug]/page.tsx:220-223` — the language `<select>` presents all four options to the user: JavaScript, Java, C++, Python.

**Problem**

Two distinct failure modes follow directly from this mismatch:

1. **Selecting "cpp":** `Submission.create(...)` succeeds (schema allows it), the POST handler returns `{ submissionId, status: "processing" }` as if work was queued, but no job is ever created. The submission's `status` stays `"pending"` forever. The frontend's `pollSubmission` (`frontend/app/problems/[slug]/page.tsx:156-190`) polls every 1000ms indefinitely — it only stops on `"completed"`/`"failed"`, which this submission will never reach.
2. **Selecting "python":** `"python"` is not in the `Submission` model's `language` enum, so `Submission.create(...)` throws a Mongoose `ValidationError`. The route handler at `backend/routes/submission.route.js:9-46` has no `try/catch`, and `server.js` registers no custom error-handling middleware, so this becomes an unhandled rejection / a generic Express HTML error page returned to a client (`frontend/app/problems/[slug]/page.tsx:132-136`) that unconditionally calls `res.json()`.

**Why It Matters**

This isn't a hypothetical edge case — it's reachable through the primary "Submit" button in the UI with a default dropdown option the UI itself offers. Users hitting "cpp" or "python" get either an infinite spinner or a broken error, with no server-side signal of what went wrong.

**Evidence**

See file/line citations above; all four locations were read directly.

**Recommended Direction**

Immediate/small fix: remove `"cpp"` and `"python"` from the frontend `<select>` until real support exists, and add a validation check in `submission.route.js` that rejects (400) any `language` not in an explicitly-shared allow-list before calling `Submission.create`. Longer-term: this is a symptom of Issue-004 (no shared contract package) — the "list of supported languages" should be defined once and imported by the model, the route, the queue setup, and the frontend, not independently re-declared four times.

**Acceptance Criteria**

- Submitting any language not backed by a live worker/queue returns an explicit 4xx error immediately, never a stuck "pending" submission and never an unhandled exception.
- The set of user-selectable languages in the frontend exactly matches the set of languages with a working queue + worker.

**Complexity:** Medium

**Dependencies:** ISSUE-004

---

## 🟠 P1 — High Priority Issues

---

### ISSUE-004 — Backend and workers are not independently deployable; they share code via relative-path filesystem coupling instead of a defined contract

**Priority:** P1

**Area:** Architecture / Backend / Workers

**Status:** Done

**Current State**

`backend/` and `workers/` are separate npm packages (separate `package.json` and presumably separate `node_modules`), but the worker code reaches directly into the backend package via relative paths:

- `workers/common/workerFactory.js:4-11` — `require("../../backend/db")`, `require("../../backend/queue")`, `require("../../backend/db_calls/updateSubmission")`, and loads dotenv from `path.resolve(__dirname, "../../backend/.env")`.
- `workers/java/executor.js:4,8` and `workers/javascript/executor.js:4,8` — both `require("../../backend/db_calls/getDetails")` and `require("../../backend/db_calls/updateSubmission")`.
- In the other direction: `backend/seedProblems.js:6` requires `"../workers/common/templateGenerator"`, and `backend/routes/admin.route.js:4` requires `"../../workers/common/templateGenerator"`.
- `workers/test_generic_architecture.js:2-3` goes one step further and requires `"../backend/node_modules/mongoose"` and `"../backend/node_modules/dotenv"` directly — reaching into another package's installed dependencies by path.

**Problem**

There is no package boundary here at all — `backend` and `workers` are really one program artificially split into two folders, glued together with `../../` requires. Mongoose models, DB connection logic, the queue definitions, and the template generator are all silently shared without any versioning, published interface, or type contract.

**Why It Matters**

This directly blocks the stated goal of "optimized submission-level execution" scaling out: workers cannot be packaged, deployed, or scaled as an independent container/process without also vendoring the entire `backend/` source tree and its `.env` file at the exact same relative path. Any refactor of `backend/models/Question.js` or `backend/db_calls/*` silently changes worker behavior with no compiler/type check to catch it — this is precisely how Issue-003's mismatch was able to happen unnoticed.

**Evidence**

File/line citations above — all confirmed by direct read.

**Recommended Direction**

Adopt **npm/yarn workspaces** (not a full monorepo toolchain like Nx/Turborepo — unnecessary at this scale) with a new `packages/shared` package containing what's genuinely shared domain logic: `templateGenerator.js`, `protocol.js`, the language/verdict enums, and the `getQuestionDetails` / `updateSubmission` data-access functions (these are shared domain logic, not backend-only). Keep `dockerSandbox.js`, `createSandbox.js`, `cleanupSandbox.js` inside `workers` (they're execution-specific and backend never needs them, aside from the templateGenerator import which moves to `shared`). `backend` and `workers` each declare `shared` as a normal dependency instead of relative-pathing into each other's folders. Do **not** merge `frontend` into this workspace — it communicates purely over the REST API already and has no code-sharing need today.

**Acceptance Criteria**

- No file under `workers/` contains a `require(...)` path that resolves into `backend/`, and vice versa.
- Workers can be started with `backend/` completely absent from disk (aside from the shared package), proving process independence.

**Complexity:** Medium

**Dependencies:** None (this is a foundational issue several others build on)

---

### ISSUE-005 — Frontend calls a logout endpoint that doesn't exist

**Priority:** P1

**Area:** Frontend / Backend contract

**Status:** Done

**Current State**

`frontend/context/AuthContext.tsx:55` calls `fetch(`${backend}/api/v1/logout`, { method: "POST", ... })`. The actual mounted route, per `backend/routes/apiRoute.js:9` (`router.use("/auth", authRoutes)`) and `backend/routes/auth.route.js:94` (`router.post("/signout", ...)`), is `/api/v1/auth/signout`.

**Problem**

The logout request 404s. Because it's wrapped in a `try/catch` that only logs the error (`AuthContext.tsx:59-61`), the failure is silent — the UI proceeds to clear its local `user` state as if logout succeeded, but the server-side `auth_token` cookie is never cleared (`res.clearCookie` in `auth.route.js:95-97` never runs).

**Why It Matters**

The user _appears_ logged out (UI shows signed-out state, header updates) but their session cookie is still valid and attached to future requests to the actual backend origin, which is a real security/correctness gap, not just cosmetic.

**Evidence**

- `frontend/context/AuthContext.tsx:53-64`
- `backend/routes/apiRoute.js:9`, `backend/routes/auth.route.js:94-102`

**Recommended Direction**

Change the frontend call to `${backend}/api/v1/auth/signout`. This is a one-line fix; the more durable fix is Issue-004/006's shared-contract work so route paths aren't hand-typed independently in two places.

**Acceptance Criteria**

- After calling logout, the `auth_token` cookie is actually cleared server-side (verifiable via response headers / browser devtools), not just local React state.

**Complexity:** Small

**Dependencies:** None

---

### ISSUE-006 — `javascript/executor.js` and `java/executor.js` are ~90% duplicated code with no shared execution engine

**Priority:** P1

**Area:** Workers / Architecture

**Status:** Done

**Current State**

Both files independently implement: an identical `compareOutputs()` function (byte-for-byte the same in both, `workers/java/executor.js:18-46` and `workers/javascript/executor.js:17-45`), the same batching loop over test cases with the same per-testcase/overall-timeout bookkeeping, the same five verdict-construction blocks (TLE / crashed / no-response / non-OK / wrong-answer / accepted), and the same `finally` cleanup calling `sandbox.destroy()` + `cleanupSandbox(jobDir)`.

**Problem**

The only real differences between the two files are: the Docker image name, the `readOnly` flag, whether there's a compile step, and the exec command (`["node","app.js"]` vs `["java","Main"]`). Everything else — around 200 lines per file — is copy-pasted.

**Why It Matters**

Every fix to verdict logic, timeout handling, or output comparison must currently be applied twice, by hand, in two files, with no compiler or test to catch drift between them (this is exactly the kind of duplication that later breeds a bug where one file is fixed and the other isn't). This is also the concrete gap standing between the current code and an actual "generic execution engine" — the templateGenerator side is already reasonably generic (`generateStarterCode`/`generateJavaScriptRunner`/`generateJavaRunner` driven off shared `questionMeta`), but the _execution_ side never got the same treatment.

**Evidence**

Direct line-by-line comparison of `workers/java/executor.js` and `workers/javascript/executor.js`.

**Recommended Direction**

Extract a single `runSubmission({ image, readOnly, compileCommand, execCommand, jobId, code, testcases, ... })` function into `workers/common/` that both `java/executor.js` and `javascript/executor.js` become thin wrappers around (each supplying only their language-specific image/commands/compile step). This does not require the shared-package/workspace change (Issue-004) to happen first — it can be done within `workers/common/` alone — but it does belong in the eventual `shared` package if compile-vs-no-compile config becomes relevant to the backend too.

**Acceptance Criteria**

- `compareOutputs` and the batch-processing loop exist in exactly one place.
- Adding a third language's executor requires supplying only image/command/compile-step config, not re-implementing the batch loop.

**Complexity:** Medium

**Dependencies:** None

---

### ISSUE-007 — Legacy, unused execution code left in the repo alongside the current engine

**Priority:** P1

**Area:** Workers / Maintainability

**Status:** Done

**Current State**

`workers/common/runDocker.js` (a per-testcase, single-container-per-run helper reading from a `jobDir/input.txt` file) and per-language `runCode.js`/`compileCode.js` (`workers/java/runCode.js`, `workers/java/compileCode.js`, `workers/javascript/runCode.js`) are fully-implemented modules that are never imported by any production code path. Verified by repo-wide grep:

```
grep -rn "runDocker" --include="*.js" .    -> only defined in runDocker.js itself
grep -rn "runCode"   --include="*.js" .    -> only defined in the two runCode.js files
grep -rn "compileCode" --include="*.js" .  -> only defined in compileCode.js
```

The actual execution path (`java/executor.js`, `javascript/executor.js`) calls `sandbox.exec(...)` and `sandbox.runInteractiveBatch(...)` directly on a `DockerSandbox` instance, never through `runCode`/`compileCode`.

**Problem**

This is a direct leftover of the "naive per-test-case execution model → optimized submission-level model" migration referenced in the project context: the old per-testcase container spin-up path (`runDocker.js`) and an intermediate abstraction (`runCode.js`/`compileCode.js`) were superseded by `DockerSandbox`'s `runInteractiveBatch`, but never deleted.

**Why It Matters**

Dead code that _looks_ like part of the execution engine is actively misleading during audits and onboarding — a new contributor reading `workers/java/` would reasonably assume `runCode.js`/`compileCode.js` are the entry points, when they're not. It also means the `DockerSandbox` class carries API surface (`exec`) that exists to serve dead callers as well as the live `executor.js` caller.

**Evidence**

Grep output above; direct reads of `runDocker.js`, `runCode.js` (both variants), `compileCode.js`, and confirmation that `executor.js` in both languages bypasses them entirely.

**Recommended Direction**

Delete `workers/common/runDocker.js`, `workers/java/runCode.js`, `workers/java/compileCode.js`, `workers/javascript/runCode.js` (or, if they're kept intentionally as a documented lower-level API, add a code comment explaining they're not part of the live path and are kept for X reason). Given they're 100% unused, deletion is the simpler and safer default.

**Acceptance Criteria**

- Every `.js` file under `workers/` is reachable from a `worker.js` entrypoint or is a genuine shared utility actually imported somewhere.

**Complexity:** Small

**Dependencies:** None

---

### ISSUE-008 — Java sandbox runs fully writable and without an explicit non-root user; inconsistent hardening vs. JS sandbox

**Priority:** P1

**Area:** Execution / Security

**Status:** Open

**Current State**

`DockerSandbox` (`workers/common/dockerSandbox.js:44-74`) builds its `docker run` args with `--cap-drop ALL`, `--security-opt no-new-privileges`, `--network none`, a memory/cpu/pids limit, and a `readOnly` flag that maps to `--read-only` or `--read-only=false` for the _entire container filesystem_. There is no `--user` flag anywhere in the file.

The JavaScript executor (`workers/javascript/executor.js:67-72`) instantiates the sandbox with `readOnly: true`. The Java executor (`workers/java/executor.js:68-73`) instantiates it with `readOnly: false`, with the comment `// Java compiler needs to write Main.class to /app`.

**Problem**

Setting `readOnly: false` makes the _whole container_ writable (there's no narrower "just make `/app` writable" option in the current flag design), not just the one directory that actually needs it. Combined with no `--user` flag (so the process runs as whatever user the base image defaults to — commonly root for `eclipse-temurin` unless the image itself drops privileges), Java submissions run with more filesystem write access than JavaScript submissions for no reason tied to an actual security requirement — it's a side effect of the binary readOnly flag being too coarse for what `javac` needs.

**Why It Matters**

`--network none` and `--cap-drop ALL` meaningfully limit blast radius already, so this isn't a full container-escape scenario, but "arbitrary write access to a root-owned container filesystem" is a wider surface than a compiler that only needs to write one `.class` file into a directory it's already mounted read-write into (`/app` is mounted via `-v ${dockerHostPath}:/app`, which is unaffected by `--read-only` in the mount sense — the flag governs the rest of the container's filesystem, not the bind mount).

**Evidence**

`workers/common/dockerSandbox.js:50-74` (docker args construction), `workers/javascript/executor.js:70-72`, `workers/java/executor.js:71-73`.

**Recommended Direction**

Keep `readOnly: true` for the Java sandbox too — the `/app` bind mount is already writable regardless of the top-level `--read-only` flag, so `javac` can still write `Main.class` there without loosening the rest of the container. Additionally consider adding an explicit `--user` (a fixed non-root UID) to `DockerSandbox`'s docker args for both languages, rather than relying on image defaults.

**Acceptance Criteria**

- Both Java and JavaScript sandboxes run with `--read-only` on the container filesystem.
- `docker run` args include an explicit non-root `--user` flag.
- Java compilation still succeeds (writes into the `/app` bind mount).

**Complexity:** Small

**Dependencies:** None

---

## 🟡 P2 — Medium Priority Issues

---

### ISSUE-009 — No automated, CI-runnable tests; existing test scripts require live infra and reach into another package's `node_modules`

**Priority:** P2

**Area:** Testing

**Status:** Open

**Current State**

`backend/package.json:6` — `"test": "echo \"Error: no test specified\" && exit 1"` (placeholder). The five files under `workers/test_*.js` (`test_admin_flow.js`, `test_advanced.js`, `test_comprehensive.js`, `test_generic_architecture.js`, `test_hardened.js`, ~1,450 lines total) are manual verification scripts, not wired into any test runner (no Jest/Mocha config anywhere in the repo). `test_generic_architecture.js:2-3` requires `../backend/node_modules/mongoose` and `../backend/node_modules/dotenv` directly by relative path — reaching into a sibling package's installed dependencies rather than declaring its own.

**Problem**

None of these scripts can run in CI without a live MongoDB instance, a live Docker daemon, and a specific pre-existing `node_modules` layout in `backend/`. They're valuable manual smoke-test scripts, but they are not automated regression tests in any repeatable sense.

**Why It Matters**

The language-mismatch bug (Issue-003) and the logout-endpoint bug (Issue-005) are exactly the class of regression that a real test suite (even a modest one, hitting the Express app with supertest and a mocked/ephemeral Mongo) would catch before merge. Right now nothing does.

**Evidence**

`backend/package.json:6`; all five `workers/test_*.js` files; `workers/test_generic_architecture.js:2-3` specifically for the cross-package `node_modules` reach.

**Recommended Direction**

Don't try to convert all five scripts into a full test suite at once. Start smaller: add `jest` (or similar) to `backend/`, write route-level tests for `submission.route.js` (covering the exact language-mismatch scenarios in Issue-003) and `auth.route.js`/`admin.route.js` (covering Issue-001/002), using an in-memory or ephemeral test Mongo. Keep the existing manual scripts as documented manual E2E smoke tests for when Docker+Mongo are actually available locally — just stop them reaching into `backend/node_modules` directly (fix once Issue-004's shared package exists, since `mongoose`/`dotenv` access should go through the shared models/config, not raw `node_modules` paths).

**Acceptance Criteria**

- `backend` has a real `test` script that runs without a live Mongo/Docker (using mocks or an in-memory DB) and covers at least the auth and submission-language-validation paths.
- No test file requires another package's `node_modules` by path.

**Complexity:** Medium

**Dependencies:** ISSUE-003, ISSUE-004

---

### ISSUE-010 — No error-handling middleware; uncaught route errors return raw Express HTML to a JSON-only frontend

**Priority:** P2

**Area:** Backend / Reliability

**Status:** Done

**Current State**

`backend/server.js` registers `cors`, `express.json()`, `cookieParser()`, and the two routers — no `app.use((err, req, res, next) => ...)` error-handling middleware exists anywhere in the file.

**Problem**

Several routes lack per-route `try/catch` (e.g., `submission.route.js`'s POST handler, `question.route.js`'s two GET handlers) — see Issue-003 for a concrete case this causes. Without global error middleware, any such uncaught error/rejection falls through to Express's default handler, which returns an HTML error page, not JSON.

**Why It Matters**

Every frontend call in this codebase does `const data = await res.json()` unconditionally on non-2xx-but-still-parsed or even implicitly on error paths (e.g. `frontend/app/problems/[slug]/page.tsx:132-136`, `frontend/context/AuthContext.tsx:42-43`) — an HTML response there throws a JSON-parse error that's swallowed by generic `catch` blocks and surfaces to the user as a generic "failed" toast with no diagnostic value.

**Evidence**

`backend/server.js` (full file, 34 lines, no error middleware); representative frontend call sites above.

**Recommended Direction**

Add a single JSON-returning error-handling middleware at the end of the middleware chain in `server.js`. Combine with adding `try/catch` to the handlers currently missing it (`submission.route.js` POST, `question.route.js` both GETs).

**Acceptance Criteria**

- Every backend error response, expected or not, is valid JSON with a `message` field.

**Complexity:** Small

**Dependencies:** None

---

### ISSUE-011 — Unbounded `limit` query parameter on the questions list endpoint

**Priority:** P2

**Area:** Backend / Reliability

**Status:** Open

**Current State**

`backend/routes/question.route.js:18-38` — `const limit = parseInt(req.query.limit) || 20;` with no upper bound before being passed to `.limit(limit)`.

**Problem**

A client can pass `?limit=999999` (or any large number) and force an unbounded query result set.

**Why It Matters**

At the current data scale (seed data has 8 questions) this is harmless, but it's a straightforward, no-cost fix that prevents a real resource-exhaustion vector as the question bank grows.

**Evidence**

`backend/routes/question.route.js:19-20`.

**Recommended Direction**

Clamp `limit` to a sane maximum (e.g., `Math.min(parseInt(req.query.limit) || 20, 100)`).

**Acceptance Criteria**

- `limit` is capped server-side regardless of what the client requests.

**Complexity:** Small

**Dependencies:** None

---

### ISSUE-012 — Unused `redis` dependency alongside `ioredis`

**Priority:** P2

**Area:** Backend / Maintainability

**Status:** Open

**Current State**

`backend/package.json:20,24` lists both `"ioredis": "^5.11.1"` and `"redis": "^6.0.1"` as dependencies. A repo-wide grep (`grep -rn "require(\"redis\")\|from \"redis\"" .`) found zero usages of the `redis` package; only `ioredis` is required (`backend/queue.js:1`, `workers/common/workerFactory.js`).

**Problem**

Dead dependency.

**Why It Matters**

Small, but every unused dependency is unnecessary install weight and an unreviewed piece of attack surface (supply-chain risk) for no functional benefit.

**Evidence**

`backend/package.json:20,24`; grep result showing no call sites.

**Recommended Direction**

Remove `redis` from `backend/package.json` and reinstall/update the lockfile.

**Acceptance Criteria**

- `redis` no longer appears in `backend/package.json` or `package-lock.json`.

**Complexity:** Small

**Dependencies:** None

---

## 🟢 P3 — Enhancements

---

### ISSUE-013 — No committed Dockerfile or docker-compose.yml; `.gitignore` actively excludes them

**Priority:** P3

**Area:** DevOps

**Status:** Open

**Current State**

No `Dockerfile` or `docker-compose.yml` exists anywhere in the delivered repository (confirmed via full recursive file listing). `backend/.gitignore` explicitly lists both under a "OS files" section:

```
# OS files
Dockerfile
docker-compose.yml
```

**Problem**

The whole execution model depends on Docker images (`eclipse-temurin:17-jdk-alpine-3.23` in `java/executor.js:71`, `node:20-alpine` in `javascript/executor.js:70`) pulled as-is from public registries, with no committed, reviewable, pinned build definition for either the sandbox images or for local orchestration of Mongo+Redis+backend+workers.

**Why It Matters**

This isn't a security hole by itself (using public images isn't inherently unsafe), but it means: (a) there's no reproducible way for a new contributor to spin up the full stack locally without hand-assembling Mongo, Redis, backend, and two workers; (b) the sandbox images aren't pinned to a digest or built from a reviewed Dockerfile, so the exact execution environment can silently drift whenever those public tags are updated upstream.

**Evidence**

`.gitignore` content (`# OS files` section); confirmed absence of any `Dockerfile`/`docker-compose.yml` file via full repo listing.

**Recommended Direction**

Commit a `docker-compose.yml` for local dev (Mongo, Redis, backend, both workers) and, if a custom sandbox image is ever needed (e.g., to bake in resource limits or strip unneeded tools), a reviewed `Dockerfile` for it — pinned by digest rather than a floating tag.

**Acceptance Criteria**

- A new contributor can start the full stack from a single `docker-compose up` (or documented equivalent) without manual service-by-service setup.

**Complexity:** Medium

**Dependencies:** None

---

### ISSUE-014 — Python starter-code generation exists with no execution support behind it

**Priority:** P3

**Area:** Workers / Architecture

**Status:** Open

**Current State**

`workers/common/templateGenerator.js` has a full `toPythonType()` mapping function (lines 28-43) and generates a Python starter stub inside `generateStarterCode()` (lines 62-73, `pyStarter`), which is included in `Question.starterCode`. There is no `generatePythonRunner()` function, no `python` worker, and no `python` queue.

**Problem**

Partial, dead-end feature: the system happily tells the frontend and the database that Python is a supported starter-code language, but there is no path to actually executing Python code. This directly feeds Issue-003's crash scenario.

**Why It Matters**

Beyond the direct bug it causes (Issue-003), this is a signal that the "generic problem engine" is generic on the _authoring_ side (type mapping, starter code) but not yet on the _execution_ side — worth tracking explicitly so it doesn't get assumed to be "already generic across languages."

**Evidence**

`workers/common/templateGenerator.js:28-43,62-73`; absence of any `generatePythonRunner` export, `python` worker file, or `python-queue` in `backend/queue.js`.

**Recommended Direction**

Either finish the Python path (add `generatePythonRunner`, a `python/executor.js` + `python/worker.js` following the pattern established in Issue-006's refactor, and a `pythonQueue`), or remove Python from `generateStarterCode` and the frontend's language list until it's ready. Given Issue-003 already requires removing `python` from the frontend selector as an immediate fix, treat "build it for real" as the deliberate follow-up here.

**Acceptance Criteria**

- Either Python submissions execute end-to-end, or no part of the system (model, starter code, frontend) advertises Python support.

**Complexity:** Large (if completing support) / Small (if removing the partial support)

**Dependencies:** ISSUE-003, ISSUE-006

---

## 🔵 Future / Long-Term

---

### ISSUE-015 — No worker concurrency/scaling configuration; single implicit concurrency per process

**Priority:** Future

**Area:** Workers / Scalability

**Status:** Open

**Current State**

`workers/common/workerFactory.js:18-20` instantiates `new Worker(queueName, processor, { connection })` with no `concurrency` option set, so BullMQ uses its default (concurrency of 1 per `Worker` instance). There's one Java worker process and one JS worker process, each single-concurrency, with no documented scaling story (no `docker-compose` replicas, no PM2/cluster config, nothing).

**Problem**

Not a bug today — the seed data is 8 questions and there's no evidence of production load — but as submission volume grows, throughput is capped at "one Java submission and one JS submission executing at a time" per the current process topology, since each Docker sandbox already consumes a full container per submission and workers process jobs serially by default.

**Why It Matters**

This is the concrete scalability bottleneck for this project: DockerSandbox already isolates submissions well at the container level, so scaling out is mostly a matter of running more worker processes (or raising `concurrency`, mindful of host resource limits since each concurrent job spins up its own Docker container) — but nothing in the current code does either.

**Evidence**

`workers/common/workerFactory.js:13-20` (no `concurrency` option passed to `Worker`); `workers/package.json:6-9` (single `worker:js`/`worker:java` scripts, no multi-instance orchestration).

**Recommended Direction**

Not urgent — flagged for when actual load materializes. When needed: pass an explicit `concurrency` to `createWorker`, bounded by host CPU/memory relative to the per-container `--memory`/`--cpus` limits already set in `DockerSandbox`, and/or run multiple worker processes behind the same queue (BullMQ supports this natively).

**Acceptance Criteria**

- Worker concurrency is an explicit, documented, tunable value rather than an implicit default.

**Complexity:** Medium

**Dependencies:** None

---

# Recommended Implementation Order

## Phase 1 — Stabilization

Fix what's actively broken or exposed right now, before anything else — these are independent of each other and can be done in parallel.

- ISSUE-001 (unauthenticated admin API)
- ISSUE-002 (password hashes leaked via admin API)
- ISSUE-005 (broken logout endpoint)
- ISSUE-003 (language contract mismatch — at minimum, restrict the frontend selector + add server-side validation immediately; the full shared-contract fix rides on Phase 2)
- ISSUE-010 (error-handling middleware, since it makes every other bug's failure mode less confusing while it's being found)

## Phase 2 — Architecture Foundation

Establish the shared-contract boundary everything else in Phase 3/4 benefits from.

- ISSUE-004 (npm workspaces + `packages/shared`)
- ISSUE-006 (unify the two executors into one engine, placed in the new shared/common layout)
- ISSUE-007 (delete dead execution code, since it's easiest to do cleanly right after ISSUE-006's refactor clarifies what's actually live)

## Phase 3 — Reliability and Testing

- ISSUE-008 (harden Java sandbox to match JS sandbox)
- ISSUE-009 (real, CI-runnable tests — write them against the post-refactor shared engine from Phase 2, not the pre-refactor duplicated one)
- ISSUE-011 (cap query limit)
- ISSUE-012 (drop unused `redis` dependency)

## Phase 4 — Scaling and Enhancements

- ISSUE-013 (Dockerfile/docker-compose for reproducible dev & sandbox images)
- ISSUE-015 (worker concurrency/scaling policy)

## Phase 5 — Product Features

- ISSUE-014 (finish or remove Python support — a product decision, not a pure engineering fix, so it's last)

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

**Total issues found:** 15

**Priority breakdown:**

- P0 (Critical): 3
- P1 (High): 5
- P2 (Medium): 4
- P3 (Enhancements): 2
- Future/Long-term: 1

**Top 5 issues to resolve first:**

1. ISSUE-001 — Unauthenticated admin API
2. ISSUE-002 — Password hashes leaked via admin API
3. ISSUE-003 — Language contract mismatch (stuck/crashing submissions)
4. ISSUE-005 — Broken logout endpoint
5. ISSUE-004 — Backend/worker filesystem coupling (unblocks the cleanest fix for #3 and everything in Phase 2)

**Recommended implementation phases:** Stabilization -> Architecture Foundation -> Reliability & Testing -> Scaling & Enhancements -> Product Features (full breakdown above).

**Recommended project/package architecture:** npm/yarn workspaces with a new `packages/shared` package for `templateGenerator`, `protocol`, shared enums, and `db_calls` — not a full monorepo toolchain, not "leave as-is." Full justification above.

**Biggest architectural risk:** The undeclared, relative-path coupling between `backend` and `workers` (ISSUE-004). It's already caused a real, shipped bug (ISSUE-003) and blocks workers from ever being deployed as an independently scalable unit.

**Biggest execution/security risk:** The completely unauthenticated admin API (ISSUE-001/002), which exposes every user's password hash and every problem's hidden test cases to anyone. This eclipses the Docker sandbox hardening gap (ISSUE-008), which is real but lower-severity given the network/capability restrictions already in place.

**Biggest scalability bottleneck:** Single-concurrency workers with no scaling configuration (ISSUE-015) — not urgent today given the seed-data scale, but it's the ceiling once real traffic arrives, since each submission already gets its own Docker container and nothing currently runs more than one at a time per language.
