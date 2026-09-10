# Koder — Repository Structure Reconnaissance & Restructuring Report

Grounded in a direct clone and inspection of `HariomPCode/koder` (default branch, snapshot taken 2026-09-09). Every claim below is backed by a file path, `grep` result, or script content actually read from the repository — not assumed from typical monorepo conventions.

---

## 1. Executive Summary

Koder is an npm-workspaces monorepo (`packages/*`, `backend`, `frontend`, `workers`) with **no CI configuration at all** (no `.github/`, confirmed absent; README's own "Limitations" section states "No CI workflow is present in the repository"). All 32 `test_*.js` files across the repo are run manually via `node <file>.js` chains wired into `package.json` scripts — there is no Jest/Mocha/Vitest runner, and none is implied by the file naming.

The most important structural fact, discovered only by reading the test files themselves (not assumed): **every single test file uses path-relative `require()`s tied to its current directory depth** (`./models/User`, `./common/dockerSandbox`, `../packages/shared/config/queues`, etc.). This means moving _any_ test file into a subdirectory is not a simple `git mv` — it requires rewriting that file's own `require()` paths, and, for two root-level files, a non-trivial rewrite (see §3, §7).

A second load-bearing fact: two test-like files live at the **repository root**, not under `backend/` or `workers/`: `test_issue706_integration.js` and `phase4_real_validation.js`. `test_issue706_integration.js` is invoked from `backend/package.json` via `node ../test_issue706_integration.js` and is (inaccurately) referenced in `PHASE_7_REDIS_LEADERBOARD.md` as `backend/test_issue706_integration.js` seven times — a documentation bug that predates any restructuring and should be fixed regardless of what else moves.

Documentation is currently flat at repo root (8 `.md` files, largest is `KODER_BACKEND_ROADMAP.md` at 132 KB). Phase 6 and Phase 7 docs are **not dead history** — they are actively cited by section number (`§16`, `§19`, `§22`, `§26`) from `ISSUES.md` and `KODER_BACKEND_ROADMAP.md` as the authoritative design source, so they must be retained and their cross-references preserved, not archived-and-forgotten.

Net recommendation: a **moderate, two-level restructuring** — categorize tests by actual domain (mirroring the categories the npm scripts already encode: CI-safe vs. Docker-dependent vs. manual-smoke, plus domain grouping for backend) and move documentation into `docs/phases/phase-NN/` and `docs/architecture/` — while explicitly rewriting every `require()` path and every script/doc reference that moves with it. No production code changes. No Phase 8 implementation.

---

## 2. Current Structure (as actually found)

```
koder/
├── .env.example
├── .gitignore
├── DOCKER.md                          # Docker Compose usage doc
├── ISSUES.md                          # 68 KB — issue ledger, Phase 1–6
├── KODER_BACKEND_ROADMAP.md           # 132 KB — master architecture/scalability roadmap
├── LICENSE
├── PHASE_2_BACKEND_ARCHITECTURE.md    # 19 KB
├── PHASE_5_CONTEST_ENGINE.md          # 16 KB
├── PHASE_6_SCORING_ENGINE.md          # 41 KB
├── PHASE_7_REDIS_LEADERBOARD.md       # 36 KB
├── README.md                          # 14 KB — canonical entry point
├── docker-compose.yml                 # mongo + redis only, no test invocation
├── package.json                       # root workspace, defines `test`/`test:ci`
├── package-lock.json
├── phase4_real_validation.js          # ORPHAN — root-level manual validation script
├── test_issue706_integration.js       # ORPHAN LOCATION — root, but "belongs" to backend
├── backend/
│   ├── package.json                   # test:ci chains 20 files (incl. ../test_issue706_integration.js)
│   ├── app.js, server.js, db.js, queue.js, middleware.js, errorHandler.js, ...
│   ├── config/ db_calls/ errors/ events/ jobs/ models/ queue/ repositories/ routes/ services/ validators/
│   └── test_admin_security.js, test_contest_engine.js, test_contest_finalization.js,
│       test_database_foundation.js, test_error_handling.js, test_language_contract.js,
│       test_leaderboard_encoding.js, test_leaderboard_projection_integration.js,
│       test_leaderboard_rebuild.js, test_leaderboard_retention.js, test_logout.js,
│       test_queue_infrastructure.js, test_scoring_contract.js, test_scoring_engine.js,
│       test_scoring_models.js, test_scoring_ordering.js, test_scoring_reconciliation.js,
│       test_standings_api.js, test_standings_redis.js, test_workspace_boundary.js
│                                        (20 files, ALL wired into backend's test:ci)
├── workers/
│   ├── package.json                   # test:ci (4), test:docker (1), test:security (1), test:smoke (5)
│   ├── app.js, nodemon.json
│   ├── common/ java/ javascript/ python/ leaderboard/ templates/
│   └── test_admin_flow.js, test_advanced.js, test_comprehensive.js, test_execution_engine.js,
│       test_generic_architecture.js, test_hardened.js, test_java_sandbox_security.js,
│       test_leaderboard_projection.js, test_python_docker.js, test_sandbox_collision_docker.js,
│       test_worker_capacity.js, test_worker_runtime_guard.js
│                                        (12 files; test_sandbox_collision_docker.js is an ORPHAN —
│                                         wired into NO npm script, confirmed by README's own text)
├── packages/shared/                   # @koder/shared — NO test files here
│   ├── config/ contracts/ db/ engine/ leaderboard/ models/ scoring/
│   └── package.json, index.js
└── frontend/                          # Next.js app — NO test files, only `lint`
```

No `.github/` directory exists anywhere in the tree. No `jest.config.*`, `vitest.config.*`, or similar exists. Confirmed by direct `find`.

---

## 3. Test-File Classification Table

Every test file's own `require()` statements were read, not inferred. "Relative depth" = how many directory levels its own `./` and `../` requires assume.

### backend/ (20 files — 100% wired into `backend`'s `test:ci`, i.e., there is **no unit/manual split in backend today** — the only real axis that exists is _domain_)

| File                                         | Classification                                                          | Relative-require pattern                  | Recommended path                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| `test_admin_security.js`                     | Auth/API security test                                                  | none (builds its own Express app in-file) | `backend/tests/auth/test_admin_security.js`                            |
| `test_logout.js`                             | Auth/API regression test                                                | `./models/...`-depth                      | `backend/tests/auth/test_logout.js`                                    |
| `test_language_contract.js`                  | Contract/unit test                                                      | shared-package import                     | `backend/tests/contracts/test_language_contract.js`                    |
| `test_scoring_contract.js`                   | Contract/unit test                                                      | shared-package import                     | `backend/tests/contracts/test_scoring_contract.js`                     |
| `test_workspace_boundary.js`                 | Architecture-boundary test (verifies no `workers/`→`backend/` requires) | filesystem-walking, not model-relative    | `backend/tests/architecture/test_workspace_boundary.js`                |
| `test_error_handling.js`                     | Infrastructure/unit test                                                | `./`-depth                                | `backend/tests/infrastructure/test_error_handling.js`                  |
| `test_database_foundation.js`                | Integration test (real/ephemeral Mongo)                                 | `./models/User`                           | `backend/tests/infrastructure/test_database_foundation.js`             |
| `test_queue_infrastructure.js`               | Infrastructure test (BullMQ/Redis config)                               | `ioredis`, `bullmq` (no relative)         | `backend/tests/infrastructure/test_queue_infrastructure.js`            |
| `test_contest_engine.js`                     | Integration test                                                        | `./models/User`                           | `backend/tests/contest/test_contest_engine.js`                         |
| `test_contest_finalization.js`               | Integration test                                                        | `./models/...`-depth                      | `backend/tests/contest/test_contest_finalization.js`                   |
| `test_scoring_models.js`                     | Unit/model test                                                         | `./models/...`-depth                      | `backend/tests/scoring/test_scoring_models.js`                         |
| `test_scoring_engine.js`                     | Integration test (52 KB, largest backend test)                          | `./models/User`                           | `backend/tests/scoring/test_scoring_engine.js`                         |
| `test_scoring_ordering.js`                   | Integration test (arrival-order determinism)                            | `./models/...`-depth                      | `backend/tests/scoring/test_scoring_ordering.js`                       |
| `test_scoring_reconciliation.js`             | Integration test (rebuild/reconcile)                                    | `./models/...`-depth                      | `backend/tests/scoring/test_scoring_reconciliation.js`                 |
| `test_leaderboard_encoding.js`               | Unit test (pure encoding functions)                                     | `@koder/shared` package import            | `backend/tests/leaderboard/test_leaderboard_encoding.js`               |
| `test_leaderboard_projection_integration.js` | Integration test (Redis projection)                                     | `./`-depth                                | `backend/tests/leaderboard/test_leaderboard_projection_integration.js` |
| `test_leaderboard_rebuild.js`                | Integration test                                                        | `./`-depth                                | `backend/tests/leaderboard/test_leaderboard_rebuild.js`                |
| `test_leaderboard_retention.js`              | Integration/infrastructure test (TTL policy)                            | `./`-depth                                | `backend/tests/leaderboard/test_leaderboard_retention.js`              |
| `test_standings_redis.js`                    | Integration test                                                        | `./`-depth                                | `backend/tests/leaderboard/test_standings_redis.js`                    |
| `test_standings_api.js`                      | API/integration test (spins up HTTP server, 36 KB)                      | `./`-depth, `http`                        | `backend/tests/leaderboard/test_standings_api.js`                      |

### workers/ (12 files — this package DOES already encode a real CI-safe/Docker/smoke split via its scripts)

| File                               | Classification                                                                                                                                                      | Wired into script | Recommended path                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------- |
| `test_execution_engine.js`         | Unit test (CI-safe)                                                                                                                                                 | `test:ci`         | `workers/tests/ci/test_execution_engine.js`             |
| `test_worker_runtime_guard.js`     | Unit/config test (CI-safe)                                                                                                                                          | `test:ci`         | `workers/tests/ci/test_worker_runtime_guard.js`         |
| `test_worker_capacity.js`          | **Benchmark harness**, not a pass/fail test (produces the throughput table cited in `ISSUES.md` ISSUE-402)                                                          | `test:ci`         | `workers/tests/ci/test_worker_capacity.js`              |
| `test_leaderboard_projection.js`   | Unit test (CI-safe)                                                                                                                                                 | `test:ci`         | `workers/tests/ci/test_leaderboard_projection.js`       |
| `test_python_docker.js`            | Docker-dependent integration test                                                                                                                                   | `test:docker`     | `workers/tests/docker/test_python_docker.js`            |
| `test_java_sandbox_security.js`    | Docker-dependent security test                                                                                                                                      | `test:security`   | `workers/tests/docker/test_java_sandbox_security.js`    |
| `test_sandbox_collision_docker.js` | **Orphan** — Docker-dependent, not wired into ANY script (README explicitly calls this out)                                                                         | none              | `workers/tests/docker/test_sandbox_collision_docker.js` |
| `test_admin_flow.js`               | Manual smoke test (needs Mongo)                                                                                                                                     | `test:smoke`      | `workers/tests/smoke/test_admin_flow.js`                |
| `test_advanced.js`                 | Manual smoke test (needs Docker); **has a known pre-existing bug** (`serializeBatch is not a function`, documented in `ISSUES.md` "Discovered During Verification") | `test:smoke`      | `workers/tests/smoke/test_advanced.js`                  |
| `test_comprehensive.js`            | Manual smoke test (needs Docker)                                                                                                                                    | `test:smoke`      | `workers/tests/smoke/test_comprehensive.js`             |
| `test_generic_architecture.js`     | Manual smoke test (needs Mongo)                                                                                                                                     | `test:smoke`      | `workers/tests/smoke/test_generic_architecture.js`      |
| `test_hardened.js`                 | Manual smoke test (needs Docker)                                                                                                                                    | `test:smoke`      | `workers/tests/smoke/test_hardened.js`                  |

### Root-level orphans (neither under `backend/` nor `workers/`)

| File                           | Classification                                                                                                              | Currently wired via                                                                                | Recommended path                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `test_issue706_integration.js` | Regression/E2E test for a specific tracked issue (spins up a full Express app + Mongo + Redis + Contest flow)               | `backend/package.json`'s `node ../test_issue706_integration.js`                                    | `backend/tests/regression/test_issue706_integration.js` |
| `phase4_real_validation.js`    | Manual, Docker/Redis/Mongo-requiring validation harness (not a pass/fail assertion test — runs real submissions end-to-end) | **nothing** — not referenced in any `package.json` or any `.md` file (confirmed by repo-wide grep) | `backend/tests/manual/phase4_real_validation.js`        |

**No test files exist under `packages/shared/` or `frontend/`.** Nothing to reorganize there.

There is no genuine "end-to-end / `integration-tests/` top-level" tier distinct from what's shown above — the closest thing to a cross-package E2E test is `test_issue706_integration.js`, which is backend-owned (it imports `backend/app`, `backend/models/*`, `backend/services/*` exclusively — it never imports `workers/` code), so it belongs under `backend/`, not a new top-level `e2e/` folder.

---

## 4. Documentation Classification Table

| File                              | Category                                                                                         | Currently cited by (section-level, not just filename)                                                                                                                       | Recommended path                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `README.md`                       | Root-level canonical documentation                                                               | — (it's the entry point)                                                                                                                                                    | stays at root                                |
| `LICENSE`                         | Root-level canonical                                                                             | —                                                                                                                                                                           | stays at root                                |
| `DOCKER.md`                       | Development/contributor documentation                                                            | `ISSUES.md` ISSUE-013 references it by name                                                                                                                                 | `docs/development/DOCKER.md`                 |
| `ISSUES.md`                       | Issue/requirements documentation (cumulative ledger, Phase 1–6, still has open items ISSUE-605+) | `KODER_BACKEND_ROADMAP.md` §Phase 6, cross-references `PHASE_6_SCORING_ENGINE.md` §16/§22/§26                                                                               | stays at root (see §6/§8 rationale)          |
| `KODER_BACKEND_ROADMAP.md`        | Architecture/design documentation (master roadmap + `ISSUE-101`–`137` series)                    | Cites `PHASE_5/6/7_*.md` by name and section; itself cited from `ISSUES.md`                                                                                                 | `docs/architecture/KODER_BACKEND_ROADMAP.md` |
| `PHASE_2_BACKEND_ARCHITECTURE.md` | Phase documentation (design-only, no impl)                                                       | Referenced implicitly by Phase 2 items in `ISSUES.md`                                                                                                                       | `docs/phases/phase-02/ARCHITECTURE.md`       |
| `PHASE_5_CONTEST_ENGINE.md`       | Phase documentation (architecture, docs-only)                                                    | Cited by `ISSUES.md` ISSUE-502/509/511 and `KODER_BACKEND_ROADMAP.md` §Phase 5                                                                                              | `docs/phases/phase-05/CONTEST_ENGINE.md`     |
| `PHASE_6_SCORING_ENGINE.md`       | Phase documentation — **still authoritative**, cited by section number                           | Cited **by section anchor** (`§16`, `§19`, `§22`, `§26`) from `ISSUES.md` and `KODER_BACKEND_ROADMAP.md`                                                                    | `docs/phases/phase-06/SCORING_ENGINE.md`     |
| `PHASE_7_REDIS_LEADERBOARD.md`    | Phase documentation — **still authoritative**, cited by section number                           | Cited by `KODER_BACKEND_ROADMAP.md` (explicit "Phase 7 correction/supersession" callout in §5.4); contains the stale `backend/test_issue706_integration.js` path references | `docs/phases/phase-07/REDIS_LEADERBOARD.md`  |

No file in this repository falls into categories 6 ("historical implementation report" as a _standalone file_), 7 ("temporary/generated/agent artifact"), or 8 ("duplicate/outdated documentation") as distinct files — those concerns exist as _sections within_ `ISSUES.md` (each issue's "What Was Fixed"/"Verification" block is a de-facto implementation report) and _within_ `KODER_BACKEND_ROADMAP.md` (which contains explicit "Status: Superseded. Do not implement." sections for its own earlier Redis-scoring design, §ISSUE-119–121 — this is intentional retained history, not clutter). No `AGENTS.md`, `CLAUDE.md`, or generated reconnaissance-report files exist in the repository today.

### Direct answer: should the completed Phase 6 and Phase 7 `.md` reports remain?

**Yes, and they must stay retrievable at a stable, discoverable path — they are not dead history.** Both `ISSUES.md` and `KODER_BACKEND_ROADMAP.md` cite `PHASE_6_SCORING_ENGINE.md` and `PHASE_7_REDIS_LEADERBOARD.md` **by internal section number**, not just by filename (e.g., "See `PHASE_6_SCORING_ENGINE.md` §16 (force-finalize), §22 (API/unregister), §26 (locked decisions)"). Deleting them would strand every one of those citations; consolidating their content into `ISSUES.md` or the roadmap would require renumbering every internal section and rewriting every cross-reference. The correct move is to relocate them intact (content unchanged, section numbers unchanged) into `docs/phases/phase-06/` and `docs/phases/phase-07/`, and update only the _file paths_ in the two documents that cite them — not their content.

---

## 5. Test-Runner Impact (§C) — What Breaks and Exactly Why

This is the section that most restructuring proposals get wrong by assuming a simple `git mv`. Nothing here is a simple move.

### 5.1 `package.json` script strings (exact, verbatim)

- **Root** `package.json`:

  ```
  "test": "npm run test:ci --workspace=backend && npm run test:ci --workspace=workers",
  "test:ci": "npm run test:ci --workspace=backend && npm run test:ci --workspace=workers",
  ```

  These reference only _workspace names_, not file paths — **unaffected by moving test files**, as long as `backend/package.json` and `workers/package.json` are updated correctly (see below).

- **`backend/package.json`** `test:ci` is a single chained string listing all 20 files **by relative path from `backend/`**, plus one file one level up:

  ```
  node test_admin_security.js && node test_language_contract.js && node test_workspace_boundary.js &&
  node test_logout.js && node test_error_handling.js && node test_database_foundation.js &&
  node test_queue_infrastructure.js && node test_contest_engine.js && node test_scoring_contract.js &&
  node test_leaderboard_encoding.js && node test_leaderboard_projection_integration.js &&
  node test_leaderboard_rebuild.js && node test_standings_redis.js && node test_leaderboard_retention.js &&
  node ../test_issue706_integration.js && node test_scoring_models.js && node test_scoring_engine.js &&
  node test_scoring_ordering.js && node test_scoring_reconciliation.js && node test_contest_finalization.js &&
  node test_standings_api.js
  ```

  **Every single segment must be rewritten** to the new path (e.g. `node tests/auth/test_admin_security.js`), and the `../test_issue706_integration.js` segment must become `node tests/regression/test_issue706_integration.js` (no more `../`, since the file is moving _into_ `backend/`).

- **`workers/package.json`** has four scripts, each a chained string of file paths relative to `workers/`:
  - `test:ci` (4 files) → each `node test_X.js` becomes `node tests/ci/test_X.js`
  - `test:docker` (1 file) → `node tests/docker/test_python_docker.js`
  - `test:security` (1 file) → `node tests/docker/test_java_sandbox_security.js`
  - `test:smoke` (5 files) → each becomes `node tests/smoke/test_X.js`
  - `test_sandbox_collision_docker.js` is not in any script today; if moved, its manual invocation instructions in `README.md` (`node workers/test_sandbox_collision_docker.js`) must also change to `node workers/tests/docker/test_sandbox_collision_docker.js`.

### 5.2 `require()` paths inside the test files themselves — the real cost

Every backend test file uses `./models/...`-style requires resolved relative to **its own file location**, not the CWD. Moving a file from `backend/test_X.js` to `backend/tests/<category>/test_X.js` adds **two levels of directory depth**, so every relative `require()` inside that file must gain two `../` segments (e.g. `require("./models/User")` → `require("../../models/User")`).

Every worker test file follows the identical pattern (`require("./common/dockerSandbox")` → `require("../../common/dockerSandbox")`; `require("../packages/shared/config/queues")` → `require("../../../packages/shared/config/queues")`).

**This means the move is not a `git mv` — it is a `git mv` plus a mechanical but exhaustive rewrite of every relative `require()` statement in all 32 files.** Files that import only via the `@koder/shared` npm-workspace package (e.g. `test_leaderboard_encoding.js`, `test_language_contract.js`, `test_scoring_contract.js`) are **unaffected** by directory depth, because Node resolves `node_modules` by walking up parent directories — as long as the file stays somewhere under `backend/` (or `workers/`), `@koder/shared` still resolves. This is a meaningful distinction: files that only need `@koder/shared` are low-risk to move; files with relative `./models/...` or `./common/...` requires are higher-risk.

### 5.3 `test_issue706_integration.js` — the highest-risk single file

This file lives at the **repository root** and its own requires assume that position:

```js
const createApp = require("./backend/app");
const User = require("./backend/models/User");
const Question = require("./backend/models/Question");
const Contest = require("./backend/models/Contest");
// ...six more require("./backend/models/...") lines
```

If this file moves to `backend/tests/regression/test_issue706_integration.js`, **every one of these lines must change from `./backend/X` to `../../X`** (up two levels out of `tests/regression/`, no `backend/` prefix needed since the file is now inside `backend/`). Getting this rewrite wrong silently breaks the test with a `MODULE_NOT_FOUND` error, not a subtle logic bug — this is mechanically checkable, but it is not optional and not automatic.

### 5.4 `phase4_real_validation.js` — same problem, undocumented consequence

This file also uses root-relative requires (`require('./backend/models/User')`, `require('./packages/shared/models/Question')`, `require('./backend/services/submission.service')`). It is not wired into any script and not referenced in any doc, so breaking it silently would not fail any CI or documented workflow — but it is still real, working code that a future agent might try to run manually, so its requires must be rewritten with the same care if it moves.

### 5.5 Docker commands

`docker-compose.yml` contains **zero test invocations** — it only defines `mongo` and `redis` services. `DOCKER.md`'s startup sequence also contains no test commands. **No Docker-related changes are needed for this restructuring.**

### 5.6 CI configuration

**None exists.** There is nothing to update here — confirmed by the absence of `.github/` and by README's own explicit statement that no CI workflow exists.

### 5.7 Documentation references to test paths

Beyond the two `PHASE_7_REDIS_LEADERBOARD.md` inaccuracies already noted (§7 below), the following doc references to test file paths would need updating if files move:

- `README.md`'s "Testing Strategy" table cites `test_execution_engine.js`, `test_python_docker.js`, `test_java_sandbox_security.js` by bare filename (no path) — low risk, but should be updated to include the new subdirectory for accuracy.
- `README.md`'s Limitations section: `node workers/test_sandbox_collision_docker.js` — must become `node workers/tests/docker/test_sandbox_collision_docker.js`.
- `ISSUES.md` cites roughly 25 distinct test file paths by name across multiple issues (`backend/test_scoring_engine.js`, `workers/test_worker_capacity.js`, etc.) — all of these are prose citations, not machine-executed paths, so they degrade gracefully (a stale doc reference, not a broken build) but should still be updated for accuracy.
- `KODER_BACKEND_ROADMAP.md` cites `backend/test_contest_engine.js`, `backend/test_scoring_contract.js`, `backend/test_scoring_models.js`, `backend/test_scoring_engine.js` by path.
- `PHASE_6_SCORING_ENGINE.md` cites `backend/test_scoring_engine.js`.
- `PHASE_7_REDIS_LEADERBOARD.md` cites 8 distinct backend test paths, **including one that is simply wrong today** (see §7) and one file that doesn't exist at all (see §7).

### 5.8 Agent instructions

No `AGENTS.md` or `CLAUDE.md` exists in this repository today, so there is nothing currently instructing an agent about test locations. This restructuring is the first opportunity to add one (optional, out of scope for this reconnaissance, flagged in §12).

---

## 6. Recommended Structure

Given §5's finding that relative-path rewrites are the dominant cost of any move (not the file moves themselves), and the explicit constraint to "prefer minimal, conventional structure over excessive nesting," the recommendation is **exactly one level of subdirectory depth beyond today** (`backend/tests/<category>/file.js`, not `backend/tests/unit/category/file.js`), because each additional level multiplies the `require()` rewrite cost.

```
backend/tests/
  auth/            test_admin_security.js, test_logout.js
  contracts/       test_language_contract.js, test_scoring_contract.js
  architecture/     test_workspace_boundary.js
  infrastructure/  test_error_handling.js, test_database_foundation.js, test_queue_infrastructure.js
  contest/         test_contest_engine.js, test_contest_finalization.js
  scoring/         test_scoring_models.js, test_scoring_engine.js, test_scoring_ordering.js,
                    test_scoring_reconciliation.js
  leaderboard/      test_leaderboard_encoding.js, test_leaderboard_projection_integration.js,
                    test_leaderboard_rebuild.js, test_leaderboard_retention.js,
                    test_standings_redis.js, test_standings_api.js
  regression/       test_issue706_integration.js   (moved in from repo root)
  manual/           phase4_real_validation.js       (moved in from repo root)

workers/tests/
  ci/               test_execution_engine.js, test_worker_runtime_guard.js,
                    test_worker_capacity.js, test_leaderboard_projection.js
  docker/           test_python_docker.js, test_java_sandbox_security.js,
                    test_sandbox_collision_docker.js
  smoke/            test_admin_flow.js, test_advanced.js, test_comprehensive.js,
                    test_generic_architecture.js, test_hardened.js
```

This is **not** the `unit/`-`integration/`-`api/`-`e2e/` split suggested as an example in the prompt, and deliberately so: that generic split doesn't match how this codebase actually organizes its tests today. Backend has no unit/integration distinction in its scripts at all (everything is CI-safe); workers already encodes a real distinction, but it's CI-safe / Docker-dependent / manual-smoke, not unit/integration. The recommended structure mirrors the distinctions the repository's own `package.json` scripts already encode, which is what makes it "based on the actual repository" rather than a generic template.

`packages/shared/` and `frontend/` need no test-directory changes (no tests exist there).

---

## 7. Current → Target Mapping (complete, all 32 test files + 8 doc files)

**Test files** — see the tables in §3 for the full per-file `CURRENT PATH → RECOMMENDED PATH → REASON`; every "Recommended path" column entry there is the target for that row's file.

**Documentation** — see §4's table for the complete mapping; every "Recommended path" column entry there is the target.

**Two documentation inaccuracies found and worth fixing during this same restructuring pass** (independent of whether files move):

1. `PHASE_7_REDIS_LEADERBOARD.md` cites `backend/test_issue706_integration.js` **seven times** — the file has never lived under `backend/`; it is at the repository root and is invoked from `backend/package.json` via a `../` relative path. This is a pre-existing documentation bug, not something the restructuring introduces.
2. `PHASE_7_REDIS_LEADERBOARD.md` also cites `backend/test_leaderboard_failure_modes.js` — **this file does not exist anywhere in the repository** (confirmed by repo-wide `find`). This is a dangling reference to a test that was apparently planned or removed but never reconciled in the doc.

Both should be corrected in the same commit that relocates `test_issue706_integration.js`, since the correct new path (`backend/tests/regression/test_issue706_integration.js`) needs to be written into the doc anyway.

---

## 8. Phase Documentation Strategy (§E)

**Approach 1 — flat `docs/phases/PHASE_N_NAME.md`:** move the four phase files as-is into one directory, no subfolders. Lowest short-term effort; matches today's 1-file-per-phase reality exactly.

**Approach 2 — `docs/phases/phase-NN/` folder per phase:** each phase gets its own directory; the existing file becomes e.g. `docs/phases/phase-06/SCORING_ENGINE.md`.

**Recommendation: Approach 2.** Two concrete pieces of evidence from the actual repository justify the extra folder-per-phase structure over the flatter option: (a) `PHASE_6_SCORING_ENGINE.md` is already internally substantial enough to be cited by numbered section (§16, §19, §22, §26) from two other documents — a phase's documentation is not a single flat artifact even today, it's a structured document with addressable parts, and a dedicated folder gives room to eventually split those parts without renaming the phase's identity; (b) Phase 8 (SSE, per `KODER_BACKEND_ROADMAP.md`'s own forward references) is explicitly upcoming and will need its own design doc at minimum — starting the convention now (`docs/phases/phase-08/`) rather than after a second file appears avoids a later awkward migration from "flat file" to "folder" for the same phase.

```
docs/phases/
  phase-02/ARCHITECTURE.md
  phase-05/CONTEST_ENGINE.md
  phase-06/SCORING_ENGINE.md
  phase-07/REDIS_LEADERBOARD.md
  phase-08/            (created empty, ready for Phase 8 work — no content added, per the
                         constraint not to begin Phase 8 implementation)
```

Phases 1, 3, and 4 have no dedicated `.md` file today (their work is described entirely inline inside `ISSUES.md`'s "Implementation Status" section) — do not fabricate `PHASE_1_*.md`/`PHASE_3_*.md`/`PHASE_4_*.md` files during this restructuring; that would be inventing documentation that never existed, not reorganizing what's there.

---

## 9. ISSUES.md / Roadmap / Phase-Report Relationship (§F)

Reading all four documents together, they form an intentional three-tier hierarchy, not accidental duplication:

1. **`PHASE_N_*.md`** — deepest authority for one subsystem. Contains locked product decisions (e.g. Phase 6's force-finalize policy table), numbered sections cited elsewhere, and measured results (Phase 7's benchmark table). This is where you go to understand _why_ a decision was made.
2. **`ISSUES.md`** — the numbered issue ledger (`ISSUE-001`–`ISSUE-609`) tracking _what_ was fixed, with "Current State"/"What Was Fixed"/"Verification" blocks per issue, and citing the relevant `PHASE_N_*.md` section for the "why." This is where you go to check _whether_ something is done and what proves it.
3. **`KODER_BACKEND_ROADMAP.md`** — the forward-looking master rollup (`ISSUE-101`–`ISSUE-137`, sized against a 10,000-user target) that summarizes Phase 5/6 status in a few lines and points at `ISSUES.md`/`PHASE_N_*.md` for detail. It also contains explicit **"Status: Superseded. Do not implement."** blocks (ISSUE-119, ISSUE-120, ISSUE-121) marking its own earlier Redis-scoring design as obsolete now that Phase 6/7 exist — this is deliberate, retained history inside a "current" document, and must not be deleted or treated as duplicate clutter.
4. **`README.md`** — should stay the onboarding layer only (how to run, current test table, architecture diagram) and should not duplicate issue-level or roadmap-level content; today it mostly succeeds at this (its "Current Verification Status" section is a two-sentence summary, not a re-listing of all 15 issues).

**Duplication found:** the Phase 6 scoring-engine story is told three times — once in full spec form in `PHASE_6_SCORING_ENGINE.md`, once per-issue in `ISSUES.md`'s Phase 6 section, and once as a rollup table in `KODER_BACKEND_ROADMAP.md` §"Phase 6 implementation status." This is the intentional three-tier layering described above, not a redundancy to eliminate — collapsing it would lose either the design rationale, the per-issue verification trail, or the cross-phase status-at-a-glance view.

**Canonical vs. historical:** `PHASE_N_*.md` files and the "What Was Fixed"/"Verification" blocks inside `ISSUES.md` are canonical (they are the record of what was actually built and why). The "Status: Superseded" blocks inside `KODER_BACKEND_ROADMAP.md` are explicitly historical/retained-for-context and are already labeled as such by the document itself — no action needed beyond preserving them during the move.

---

## 10. Naming Conventions (§G)

- **Test files:** keep the existing `test_<domain>_<subject>.js` snake_case convention unchanged — it is already 100% consistent across all 32 files, and renaming to `*.test.js` would require rewriting every `package.json` script reference for no functional benefit (there is no Jest/Mocha auto-discovery relying on that suffix anywhere in this repo).
- **Test directories:** short, lowercase, single-word, matching the domain or the npm-script name that already exists (`ci/`, `docker/`, `smoke/` for workers — these names are taken directly from the existing script names `test:ci`/`test:docker`/`test:smoke`; `auth/`, `contracts/`, `architecture/`, `infrastructure/`, `contest/`, `scoring/`, `leaderboard/`, `regression/`, `manual/` for backend, matching the domain boundaries the files themselves already respect).
- **Phase documentation:** `docs/phases/phase-NN/<TOPIC>.md` — drop the redundant `PHASE_N_` filename prefix once the folder itself encodes the phase number.
- **Architecture documents:** `docs/architecture/<TOPIC>.md`.
- **Implementation reports:** no standalone files of this type exist today; if one is ever split out of `ISSUES.md`, name it `docs/phases/phase-NN/IMPLEMENTATION_REPORT.md`.
- **Issue documentation:** keep `ISSUES.md` as a single root-level file — the current single-file-with-anchors convention (`### ISSUE-NNN — ...`) is already navigable at this repo's scale (roughly 40 issues across all phases) and fragmenting it into per-issue files would break every "See ISSUES.md ISSUE-NNN" cross-reference in the other three documents for no clear benefit.

---

## 11. Migration Plan

Ordered so that each stage is independently verifiable before the next begins.

### Stage 0 — Preparation

1. Create a git branch dedicated to this restructuring; do not do this on `main` directly.
2. Run the full test suite once, on the current structure, and record the output verbatim (`npm run test:ci --workspace=backend`, `npm run test:ci --workspace=workers`) as the baseline to diff against after each stage.

### Stage 1 — Documentation moves (lowest risk; no code depends on `.md` file location)

3. **Create:** `docs/phases/phase-02/`, `docs/phases/phase-05/`, `docs/phases/phase-06/`, `docs/phases/phase-07/`, `docs/architecture/`, `docs/development/`.
4. **Move:** `PHASE_2_BACKEND_ARCHITECTURE.md` → `docs/phases/phase-02/ARCHITECTURE.md`; `PHASE_5_CONTEST_ENGINE.md` → `docs/phases/phase-05/CONTEST_ENGINE.md`; `PHASE_6_SCORING_ENGINE.md` → `docs/phases/phase-06/SCORING_ENGINE.md`; `PHASE_7_REDIS_LEADERBOARD.md` → `docs/phases/phase-07/REDIS_LEADERBOARD.md`; `KODER_BACKEND_ROADMAP.md` → `docs/architecture/KODER_BACKEND_ROADMAP.md`; `DOCKER.md` → `docs/development/DOCKER.md`.
5. **Rename (content, not path):** none — file _contents_ stay byte-identical in this stage, including all internal section numbers.
6. **Update references:** every place `ISSUES.md`, `README.md`, and the roadmap cite these files by their old path — rewrite to the new path only, leave the cited section numbers (`§16` etc.) untouched since those didn't move.
7. **What should NOT move:** `README.md`, `LICENSE`, `ISSUES.md` — all three stay at repo root (see §9 rationale for `ISSUES.md`).
8. **Test after this stage:** none of the test suites touch `.md` files, so run the Stage 0 baseline commands again and confirm identical output (this stage cannot break test execution — it's a documentation-only sanity check).
9. **Git checkpoint:** commit Stage 1 alone, separate from any code/test moves, so it can be reverted independently if a doc cross-reference is missed.

### Stage 2 — Fix the two pre-existing documentation inaccuracies (independent of file moves)

10. In `docs/phases/phase-07/REDIS_LEADERBOARD.md`, correct all seven `backend/test_issue706_integration.js` references to the file's actual/future location (coordinate with Stage 3 so this is written once, correctly, to the final path).
11. Either remove the reference to `backend/test_leaderboard_failure_modes.js` or flag it explicitly as "planned, not yet implemented" — do not leave a silent dangling reference.
12. **Git checkpoint:** commit separately, since this is a correctness fix independent of restructuring.

### Stage 3 — Workers test moves (self-contained package, does not touch backend)

13. **Create:** `workers/tests/ci/`, `workers/tests/docker/`, `workers/tests/smoke/`.
14. **Move** each of the 12 `workers/test_*.js` files per the §3 table.
15. **Rewrite** every relative `require()` in all 12 files to account for the new one-level-deeper nesting (every `./common/X` → `../../common/X`; every `../packages/shared/X` → `../../../packages/shared/X`).
16. **Update** `workers/package.json`'s four scripts (`test:ci`, `test:docker`, `test:security`, `test:smoke`) to the new paths.
17. **Update** `README.md`'s manual-invocation instruction for `test_sandbox_collision_docker.js`.
18. **Tests that must be run after this stage:** `npm run test:ci --workspace=workers` (must pass — these are the CI-safe ones); if Docker is available in the environment, also `npm run test:docker --workspace=workers` and `npm run test:security --workspace=workers`; `test:smoke` requires live Mongo/Docker and is best-effort per its existing "manual" status.
19. **Git checkpoint:** commit Stage 3 alone.

### Stage 4 — Backend test moves, including the two root-level orphans (highest risk — largest file count and the two files with the most fragile requires)

20. **Create:** the nine `backend/tests/<category>/` directories listed in §6.
21. **Move** the 20 existing `backend/test_*.js` files per the §3 table.
22. **Move** `test_issue706_integration.js` from repo root into `backend/tests/regression/test_issue706_integration.js`.
23. **Move** `phase4_real_validation.js` from repo root into `backend/tests/manual/phase4_real_validation.js`.
24. **Rewrite** every relative `require()` in all 22 files. Pay special attention to `test_issue706_integration.js`: its ten-plus `require("./backend/models/...")` and `require("./backend/app")` lines must become `require("../../models/...")` and `require("../../app")` (two levels up out of `tests/regression/`, with no `backend/` segment since the file is now inside `backend/`). Apply the identical transformation to `phase4_real_validation.js`.
25. **Update** `backend/package.json`'s single `test:ci` chain — every one of its 21 segments (20 backend files + the former `../test_issue706_integration.js`) — to the new in-package paths.
26. **Update** every doc reference found in §5.7 (`ISSUES.md`, the relocated `docs/architecture/KODER_BACKEND_ROADMAP.md`, the relocated `docs/phases/phase-06/SCORING_ENGINE.md`, the relocated `docs/phases/phase-07/REDIS_LEADERBOARD.md`) to the new backend test paths.
27. **Tests that must be run after this stage:** `npm run test:ci --workspace=backend` (must pass — this is the full chain, including the relocated regression test) and `npm run test --workspace=backend`. Manually run `node backend/tests/manual/phase4_real_validation.js` only if Docker/Mongo/Redis are live, to confirm it still resolves its `require()`s correctly, even though it was never part of an automated suite.
28. **Git checkpoint:** commit Stage 4 alone — this is the stage most likely to need a targeted revert if one `require()` rewrite is missed.

### Stage 5 — Final verification

29. Run `npm run test:ci` at the repo root (chains both workspaces) and confirm it passes end-to-end exactly as it did in the Stage 0 baseline.
30. Run a repo-wide `grep` for the old file paths (`test_.*\.js` at old locations, old `.md` filenames) across `*.md`, `*.json`, and `*.js` to catch any missed reference.
31. Diff the Stage 0 baseline test output against the final run's output — they should be behaviorally identical (same pass/fail per test), since no test semantics changed, only file locations.

### What should be archived

Nothing in this repository currently qualifies as "archive, don't touch" — every `.md` file is either still-canonical (`README.md`, `ISSUES.md`) or still-cited-by-section-number (`PHASE_6`/`PHASE_7`). No file should be moved to a `docs/archive/` tier in this pass.

### What should be deleted only if proven unnecessary

Nothing identified during this reconnaissance should be deleted. The two documentation inaccuracies (§7) are corrections, not deletions of value. `test_sandbox_collision_docker.js`'s orphan status (not wired into any script) is a candidate for **wiring into `workers/package.json`** (e.g. as `test:collision`) rather than deletion, since it is real, working, Docker-verifiable code per README's own description — but that's a scope decision for the person to make, not this reconnaissance to decide unilaterally.

---

## 12. Risk Assessment

**Low risk (file move only, no `require()` rewrite needed):**

- All four `PHASE_*.md` moves and the `KODER_BACKEND_ROADMAP.md`/`DOCKER.md` moves (Stage 1) — markdown files have no runtime dependency on their own path.
- `test_leaderboard_encoding.js`, `test_language_contract.js`, `test_scoring_contract.js` — these import only via the `@koder/shared` package, which resolves regardless of directory depth as long as the file stays under `backend/`.

**Medium risk (mechanical `require()` rewrite required, but pattern is uniform and testable):**

- The other 17 backend test files and all 12 worker test files — each needs exactly two additional `../` segments added to its existing relative requires; a missed rewrite fails loudly (`MODULE_NOT_FOUND`) rather than silently, so Stage 5's full-suite run will catch any miss.
- `backend/package.json` and `workers/package.json` script-string edits — a typo here also fails loudly (script exits non-zero on the first bad path).

**High risk (non-uniform rewrite, currently-inaccurate doc cross-references, root-level provenance):**

- `test_issue706_integration.js` — its requires use a different relative pattern (`./backend/X` from repo root) than every other file being moved (`./X` from inside `backend/`), so the rewrite rule is not "add two `../`" like everywhere else, it's "remove the `backend/` prefix and add `../../`." This file also has the pre-existing wrong-path documentation problem (§7) layered on top, so this single file has three simultaneous change vectors (its own requires, its `package.json` invocation, and multiple wrong doc citations) that must all land consistently in the same commit.
- `phase4_real_validation.js` — same root-relative-require pattern as above, but with **zero** existing references anywhere to double-check against; a mistake here would go unnoticed by grep-based verification and would only surface if someone tries to run it manually.

**Files that must absolutely not be moved without updating references (in order of how many things break):**

1. `test_issue706_integration.js` — breaks `backend/package.json`'s `test:ci` chain, its own 10+ internal requires, and (already-wrong) citations in `PHASE_7_REDIS_LEADERBOARD.md`.
2. Any of the 20 `backend/test_*.js` files — each breaks its own requires and one segment of `backend/package.json`'s single long `test:ci` chain.
3. Any of the 12 `workers/test_*.js` files — each breaks its own requires and one segment of one of `workers/package.json`'s four scripts.
4. `PHASE_6_SCORING_ENGINE.md` / `PHASE_7_REDIS_LEADERBOARD.md` — moving without updating the citing documents' file-path references (not their section numbers, which stay valid) breaks discoverability for anyone following a "see §16" pointer from `ISSUES.md`.

---

## 13. Final Proposed Repository Tree

```
koder/
├── .env.example
├── .gitignore
├── LICENSE
├── README.md
├── docker-compose.yml
├── package.json
├── package-lock.json
├── ISSUES.md
├── docs/
│   ├── architecture/
│   │   └── KODER_BACKEND_ROADMAP.md
│   ├── development/
│   │   └── DOCKER.md
│   └── phases/
│       ├── phase-02/ARCHITECTURE.md
│       ├── phase-05/CONTEST_ENGINE.md
│       ├── phase-06/SCORING_ENGINE.md
│       ├── phase-07/REDIS_LEADERBOARD.md
│       └── phase-08/                      (empty — reserved, no Phase 8 content added)
├── backend/
│   ├── package.json
│   ├── app.js, server.js, db.js, queue.js, middleware.js, errorHandler.js, ...
│   ├── config/ db_calls/ errors/ events/ jobs/ models/ queue/ repositories/ routes/ services/ validators/
│   └── tests/
│       ├── auth/            test_admin_security.js, test_logout.js
│       ├── contracts/       test_language_contract.js, test_scoring_contract.js
│       ├── architecture/     test_workspace_boundary.js
│       ├── infrastructure/  test_error_handling.js, test_database_foundation.js,
│       │                    test_queue_infrastructure.js
│       ├── contest/         test_contest_engine.js, test_contest_finalization.js
│       ├── scoring/         test_scoring_models.js, test_scoring_engine.js,
│       │                    test_scoring_ordering.js, test_scoring_reconciliation.js
│       ├── leaderboard/      test_leaderboard_encoding.js,
│       │                    test_leaderboard_projection_integration.js,
│       │                    test_leaderboard_rebuild.js, test_leaderboard_retention.js,
│       │                    test_standings_redis.js, test_standings_api.js
│       ├── regression/       test_issue706_integration.js   (moved from repo root)
│       └── manual/           phase4_real_validation.js       (moved from repo root)
├── workers/
│   ├── package.json
│   ├── app.js, nodemon.json
│   ├── common/ java/ javascript/ python/ leaderboard/ templates/
│   └── tests/
│       ├── ci/     test_execution_engine.js, test_worker_runtime_guard.js,
│       │            test_worker_capacity.js, test_leaderboard_projection.js
│       ├── docker/  test_python_docker.js, test_java_sandbox_security.js,
│       │            test_sandbox_collision_docker.js
│       └── smoke/   test_admin_flow.js, test_advanced.js, test_comprehensive.js,
│                    test_generic_architecture.js, test_hardened.js
├── packages/shared/           (unchanged — no tests exist here)
└── frontend/                  (unchanged — no tests exist here)
```

---

## 14. Final Recommendation

Move test files into **domain-based** subdirectories that mirror the distinctions the repository's own `package.json` scripts already encode (CI-safe vs. Docker-dependent vs. manual-smoke for workers; auth/contracts/architecture/infrastructure/contest/scoring/leaderboard/regression/manual for backend) rather than a generic unit/integration/e2e template — because that's what the actual test content and actual script wiring already imply, and inventing a different taxonomy would create a mismatch between directory name and script behavior. Relocate the two root-level orphans (`test_issue706_integration.js`, `phase4_real_validation.js`) into `backend/tests/regression/` and `backend/tests/manual/` respectively, since both exclusively exercise backend code and neither belongs loose at repo root next to `README.md`/`LICENSE`. Move documentation into `docs/phases/phase-NN/` (folder-per-phase, anticipating Phase 8's own upcoming design doc) and `docs/architecture/`, while leaving `README.md` and `ISSUES.md` at the root as the two canonical entry points a new contributor or agent should find immediately.

This is better than the current structure for three concrete reasons grounded in what was actually found: (1) it eliminates the two stray test-like files sitting at repo root beside documentation, which today makes the root directory listing look like it contains scratch scripts; (2) it groups backend's 20 test files by the domain a future Phase 8 contributor would actually search for (e.g., "where are the leaderboard tests" resolves to one directory instead of a flat list of 20 files sorted alphabetically by an unrelated prefix); (3) it fixes two pre-existing, verifiable documentation inaccuracies (the wrong `backend/` path for `test_issue706_integration.js`, and a citation to a test file that doesn't exist) that predate this restructuring and would otherwise persist indefinitely.

The explicit cost — and the reason this migration must be done carefully rather than as a bulk `git mv` — is that all 32 test files use path-relative `require()`s, so every file's internal imports must be rewritten in lockstep with its move, and `backend/package.json`'s single 21-segment `test:ci` chain and `workers/package.json`'s four scripts must be updated to match exactly. No production code under `backend/services`, `backend/models`, `packages/shared`, or `workers/common` needs to change at all — only test-file locations, test-file internal requires, package script strings, and documentation path references.
