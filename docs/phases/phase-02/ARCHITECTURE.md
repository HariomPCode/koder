# Phase 2 — Backend Architecture Blueprint

Status: design-only, no implementation changes yet.
Scope: backend architecture only for the monolithic API layer. This phase intentionally does not add worker logic, queue behavior changes, Redis, SSE, leaderboard logic, contest scoring, or frontend work.

## 1. Current codebase baseline

The real repository already shows a working backend shape that should be preserved while making the service boundaries explicit:

- Express app bootstraps in `backend/app.js`
- Route mounting happens in `backend/routes/apiRoute.js` and `backend/routes/admin.route.js`
- Auth and admin guards live in `backend/middleware.js`
- Practice submission intake lives in `backend/routes/submission.route.js`
- User stats live in `backend/routes/user.route.js`
- Queue access is centralized in `backend/queue.js`
- Persistent models are split between `backend/models/*.js` and `packages/shared/models/*.js`
- Shared contracts and enums live in `packages/shared/contracts/*.js`
- The repository already uses a shared package boundary (`@koder/shared`) and the current system is monolithic but structurally close to a modular backend design.

This phase formalizes that monolith into explicit modules without changing behavior.

## 2. Architecture goal

Create a modular backend that is still a single Express application, but with explicit boundaries:

- HTTP layer
- authentication/authorization layer
- application services
- domain rules
- data-access layer
- queue adapter
- event publisher abstraction
- validation/error handling layer

The design must preserve the existing single-tenant monolith, not convert to microservices.

## 3. Proposed module boundaries

### 3.1 HTTP boundary

Files to be owned by this layer:

- `backend/app.js`
- `backend/routes/apiRoute.js`
- `backend/routes/auth.route.js`
- `backend/routes/question.route.js`
- `backend/routes/submission.route.js`
- `backend/routes/user.route.js`
- `backend/routes/admin.route.js`

Responsibilities:

- parse HTTP input
- authenticate and authorize via middleware
- call application services
- serialize success/error responses
- never contain domain business rules or raw database logic

Rules:

- Routes may call services only.
- Routes must not call `mongoose` directly after this phase.
- Routes must not create queue jobs directly after this phase.
- Routes must not perform cross-entity business logic.

### 3.2 Authentication and authorization boundary

Files to own this layer:

- `backend/middleware.js`
- `backend/auth/*` (new, future)
- `backend/permissions/*` (new, future)

Responsibilities:

- read/validate JWT cookies
- attach `req.user` / `req.userId`
- enforce role checks (`admin` vs `user`)
- centralize access policy rules

Decision:

- Maintain the same JWT-cookie contract as today (`auth_token` cookie)
- Keep role checks in a dedicated policy function, not spread across routes
- Do not add auth library churn in Phase 2; this is structural only

### 3.3 Application service layer

New files to add:

- `backend/services/auth.service.js`
- `backend/services/user.service.js`
- `backend/services/question.service.js`
- `backend/services/submission.service.js`
- `backend/services/admin-question.service.js`

Responsibilities:

- orchestrate business operations
- validate request semantics within app rules
- call repositories and queue adapters
- convert domain errors into HTTP-safe outcomes

Rules:

- Service methods are the only allowed coordinate point between routes and persistence
- Each service should be thin and focused on one domain
- Service methods should receive clear input DTOs and return domain objects or result DTOs

### 3.4 Repository/data-access layer

New files to add:

- `backend/repositories/user.repository.js`
- `backend/repositories/question.repository.js`
- `backend/repositories/submission.repository.js`
- `backend/repositories/contest.repository.js` (future contract only, not implemented in this phase)

Responsibilities:

- encapsulate Mongoose queries and projections
- centralize `find`, `findById`, `create`, `update`, `delete` patterns
- hide Mongo-specific query details from route and service code

Rules:

- No route calls `Question.findById` or `Submission.create` directly
- Repository layer abstracts collection names and query shapes
- This is the primary migration boundary from the current repo’s direct Model usage

### 3.5 Queue abstraction boundary

Current file:

- `backend/queue.js`

Proposed future contract:

- `backend/queue/queueClient.js` or `backend/services/queueAdapter.js`

Responsibilities:

- expose a single interface for all queue operations
- encapsulate language-to-queue mapping
- hide BullMQ specifics from application code

Example interface:

- `enqueueSubmission({ submissionId, language, ... })`
- `getQueueByLanguage(language)`
- `isQueueHealthy()`

Explicit rule:

- No route or service writes raw `jsQueue.add()` calls directly
- The queue adapter sits behind a small interface, even though BullMQ remains the actual implementation in this phase

### 3.6 Event abstraction boundary

Current reality:

- current code dispatches jobs, but there is no explicit domain event contract

Proposed future contract for Phase 2:

- `backend/events/submission-events.js` or `backend/events/eventBus.js`
- `backend/events/publisher.js`

Responsibilities:

- define domain event names for lifecycle changes
- abstract transport from internal event publication
- keep event names consistent with the lifecycle contract (`created`, `queued`, `running`, `completed`)

Rules:

- events are domain-level, not queue-implementation-level
- transport details (BullMQ, Redis pub/sub, SSE) are intentionally behind the event abstraction
- no direct Redis or SSE code in the API layer in this phase

### 3.7 Validation and error-handling boundary

Files to own this layer:

- `backend/errorHandler.js`
- `backend/validators/*.js` (new)
- `backend/utils/errors.js` (new)

Responsibilities:

- parse invalid request fields
- normalize validation failures
- convert domain errors to consistent HTTP responses
- surface `AppError` classes and 4xx/5xx mapping

Rules:

- validation should be split into request validation and domain validation
- Mongoose schema validation stays in the model layer where it already exists
- route/service validation should focus on input contract and authorization rules

## 4. Dependency graph

This is the proposed dependency order for Phase 2:

```text
HTTP routes
   ↓
Application services
   ↓
Repositories / model adapters
   ↓
Mongoose models (shared package)
   ↓
MongoDB

HTTP routes
   ↓
Auth middleware / policy layer
   ↓
JWT + user lookup

HTTP routes
   ↓
Queue adapter
   ↓
BullMQ queue abstraction
   ↓
Workers (out of scope for this phase)

HTTP routes / services
   ↓
Event publisher abstraction
   ↓
Domain lifecycle events
```

Key constraint:

- the API layer should depend on services, not on repositories and not directly on BullMQ or Mongoose
- services depend on repositories and adapters
- adapters depend on infrastructure libraries (BullMQ, Redis, Mongoose)
- no circular dependencies between modules

## 5. Submission lifecycle and state machine

The current codebase already runs a practice submission flow:

`POST /api/v1/submissions/:questionId` → creates `Submission` → queues language-specific BullMQ job → worker executes → updates submission verdict.

The Phase 2 architecture should explicitly model the lifecycle as a domain contract, not as ad-hoc route state:

```text
CREATED
  ↓
QUEUED
  ↓
RUNNING
  ↓
COMPLETED
```

Notes:

- `CREATED` is the database record existence point before the external queue accepts or acknowledges the job
- `QUEUED` means the enqueue was accepted by the queue abstraction
- `RUNNING` means the worker has claimed the job and started execution
- `COMPLETED` is still the terminal result state and retains the verdict contract (`Accepted`, `Wrong Answer`, `Runtime Error`, etc.)
- No new `FAILED` status is introduced in Phase 2, because the current architecture uses `COMPLETED` with verdict semantics to represent terminal judge outcomes

Boundary requirement:

- express routes should not mutate submission state directly except for creation in the initial intake path
- all lifecycle transitions should be mediated through a submission service or adapter contract, even if the implementation is still a direct Mongoose update in the initial phase

## 6. API contract boundaries

Phase 2 should preserve the existing route surface and divide responsibilities cleanly. The routes should remain functionally same, but the flow becomes:

### Public API

- `GET /api/v1/auth/...` — auth flows
- `GET /api/v1/user` — identity/profile fetch
- `GET /api/v1/user/stats` — derived stats, repository-backed aggregation
- `GET /api/v1/questions` — list
- `GET /api/v1/questions/:questionId` — detail
- `POST /api/v1/submissions/:questionId` — submit code
- `GET /api/v1/submissions/:submissionId` — fetch one submission
- `GET /api/v1/submissions/question/:questionId` — user submission history for one question

### Admin API

- `GET /admin/users`
- `GET /admin/questions`
- `GET /admin/questions/:questionId`
- `POST /admin/questions`
- `PUT /admin/questions/:questionId`
- `DELETE /admin/questions/:questionId`

Contract rule:

- HTTP contract stays stable in Phase 2; no new API route semantics are introduced beyond the internal refactor
- route responsibilities remain request parsing and response shape only

## 7. Database access boundaries

Current codebase pattern:

- direct `Question.findById`, `Submission.create`, `User.findById` in routes
- minimal shared package boundary for models

Phase 2 target:

- all persistence calls go through repositories
- model schema is still the source of truth, but routes/services do not depend on schema mechanics directly

Examples:

- `UserRepository.findByIdForAuth(userId)`
- `QuestionRepository.findById(questionId)`
- `QuestionRepository.listOrderedByQuestionNum()`
- `SubmissionRepository.createPracticeSubmission(data)`
- `SubmissionRepository.findByUserAndQuestion(userId, questionId)`
- `SubmissionRepository.findByUser(userId)` (with a bounded query for stats, not unbounded full-history scan)

This keeps database access centralized for future contest and leaderboard phases without implementing them now.

## 8. Queue abstraction design

Current real code:

```js
const { jsQueue, javaQueue, pythonQueue } = require("../queue");
```

The Phase 2 architecture should wrap this in a message adapter layer so that:

- routes do not know queue names
- services do not know BullMQ classes
- queue selection remains a single mapping at the infrastructure edge

Target interface:

```text
SubmissionQueueAdapter.enqueueSubmission({ submissionId, language, userId, questionId })
```

Implementation detail during Phase 2:

- use existing `Queue` objects under the hood
- maintain language dispatch map `javascript -> jsQueue`, `java -> javaQueue`, `python -> pythonQueue`
- do not add queue retries, Redis changes, or new worker architecture in Phase 2

## 9. Event abstraction design

The repo currently has no explicit event contract beyond queue dispatch. Phase 2 should define a minimal event layer for future phases while not implementing Redis or SSE yet.

Proposed event names:

- `submission.created`
- `submission.queued`
- `submission.running`
- `submission.completed`

Proposed event publisher contract:

```text
SubmissionEventPublisher.emit(eventName, payload)
```

Implementation note:

- For Phase 2, this may be an in-process adapter or a thin no-op wrapper that later routes into BullMQ/Redis/SSE
- it is not required to be real-time or persistent yet
- the important part is the contract boundary and naming

This is intentionally not a Redis stream implementation, SSE implementation, or leaderboard consumer.

## 10. Validation and error handling boundaries

Current practice:

- Mongoose schemas validate required fields and enums
- routes perform request validation for language and code checks
- Express error-handling middleware catches failures

Phase 2 target design:

### Request validation

- route-level validation for system inputs
- e.g. language support, required code, auth token presence

### Domain validation

- service-level validation for business invariants
- e.g. question exists and user is allowed to submit

### Schema validation

- model-level validation for Mongoose schema constraints

### Error contract

Define canonical error shapes, for example:

```json
{
  "error": "validation_error",
  "message": "Unsupported language: 'rust'",
  "details": { "field": "language" }
}
```

and for auth:

```json
{
  "error": "unauthorized",
  "message": "Authentication required"
}
```

This keeps HTTP concerns out of services and avoids route-specific error logic.

## 11. Authentication and authorization boundaries

Current real behavior:

- `backend/middleware.js` uses `authMiddleware` and `adminMiddleware`
- `auth_token` cookie is checked
- `adminMiddleware` verifies user role via `User.findById`

Phase 2 should preserve exactly that behavior and clarify the boundaries:

- `AuthContextResolver`: extracts user from request cookies/JWT
- `UserSessionPolicy`: checks authentication state and roles
- `AdminPolicy`: checks `role === "admin"`

No new auth provider or session store is introduced.

## 12. Migration plan from current implementation

The migration must be behavior-preserving and low-risk.

### Step 1 — Create the boundary skeleton

Add new directories/files without changing route behavior:

- `backend/services/`
- `backend/repositories/`
- `backend/validators/`
- `backend/errors/`
- `backend/queue/`
- `backend/events/`

### Step 2 — Introduce adapters, not new behavior

Wrap current direct dependencies behind adapters:

- `QueueAdapter` around `backend/queue.js`
- `SubmissionEventPublisher` around future event transport
- `UserRepository` around `User.findById` and `User.create`
- `QuestionRepository` around `Question.find` and `Question.findById`
- `SubmissionRepository` around `Submission.create` and query patterns

### Step 3 — Move services behind routes

Routes keep the same endpoints but use service methods:

- `authService.verifySession(cookie)`
- `userService.getProfile(userId)`
- `questionService.listQuestions()`
- `submissionService.createSubmission({ userId, questionId, language, code })`

### Step 4 — Keep queue and worker behavior identical

Do not change queue names, add retries, or change submission status semantics in this phase.

### Step 5 — Add internal tests for boundaries

- route -> service wiring
- repository contract coverage
- dependency invariant checks
- no circular imports
- no route-level direct DB access after migration

### Step 6 — Keep all current endpoints stable

No API or frontend surface changes during Phase 2. The route layer is refactored, not replaced.

## 13. Issue breakdown for Phase 2

### ISSUE-201 — Backend service boundary is implicit and route-coupled to persistence and queue internals

- Problem: route handlers currently call Mongoose models and queue objects directly
- Impact: business logic and infrastructure are mixed together
- Fix direction: add service/repository/adapters

### ISSUE-202 — Authentication/authorization policy is embedded inside middleware without a clear policy layer

- Problem: auth and admin checks live in a single file without explicit policy contracts
- Impact: difficult to extend to future contest/admin scenarios
- Fix direction: split `AuthContextResolver`, `SessionPolicy`, `AdminPolicy`

### ISSUE-203 — Submission lifecycle is not represented as a domain contract in the API layer

- Problem: the lifecycle is implicit through direct queue writes and Mongoose state changes
- Impact: future contest and worker phases need a stronger contract than ad-hoc status updates
- Fix direction: define domain event and lifecycle contract (`CREATED` → `QUEUED` → `RUNNING` → `COMPLETED`)

### ISSUE-204 — Validation and error handling are scattered across routes and models

- Problem: input validation and response shaping are duplicated across the API layer
- Impact: inconsistent error formats and harder future extension
- Fix direction: centralize request validation and app error mapping

### ISSUE-205 — Queue and event infrastructure is not abstracted behind a stable backend contract

- Problem: routes depend on BullMQ objects directly
- Impact: future Redis/SSE/contest consumer work will be tightly coupled to the HTTP layer
- Fix direction: queue adapter and event publisher interfaces

### ISSUE-206 — Database access patterns are not centralized behind repositories

- Problem: repository query patterns are spread across routes and direct model calls
- Impact: harder future contest registration, leaderboard, and report queries
- Fix direction: centralize Mongoose access in repositories

## 14. Files that would change during this phase

This is the proposed change list for the actual implementation later; no code is changed in this document.

### Existing files likely to be touched

- `backend/app.js`
- `backend/middleware.js`
- `backend/errorHandler.js`
- `backend/queue.js`
- `backend/routes/apiRoute.js`
- `backend/routes/auth.route.js`
- `backend/routes/question.route.js`
- `backend/routes/submission.route.js`
- `backend/routes/user.route.js`
- `backend/routes/admin.route.js`
- `backend/models/User.js`
- `backend/models/Question.js`
- `backend/models/Submission.js`
- `packages/shared/index.js`
- `packages/shared/contracts/verdicts.js`

### New files to add

- `backend/services/auth.service.js`
- `backend/services/user.service.js`
- `backend/services/question.service.js`
- `backend/services/submission.service.js`
- `backend/services/admin-question.service.js`
- `backend/repositories/user.repository.js`
- `backend/repositories/question.repository.js`
- `backend/repositories/submission.repository.js`
- `backend/validators/request.validators.js`
- `backend/errors/appError.js`
- `backend/events/submissionEventPublisher.js`
- `backend/queue/queueAdapter.js`

## 15. Non-goals for this phase

This phase explicitly does not include:

- BullMQ tuning or worker configuration changes
- Redis leaderboard implementation
- SSE or real-time event streaming
- contest scoring
- contest registration and scheduler logic
- frontend changes
- load-testing or performance tuning

Those belong to later phases after the backend architecture boundaries are established.

## 16. Decision summary

The correct Phase 2 move is to preserve the single Express monolith and introduce explicit module boundaries around services, repositories, queue adapters, validation/error handling, and lifecycle events. This is the minimal structural upgrade that lets later phases add contests, worker architecture, and leaderboard logic without entangling all concerns inside route handlers.
