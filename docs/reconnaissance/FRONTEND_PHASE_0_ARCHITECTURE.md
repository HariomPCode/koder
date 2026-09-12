# Koder Frontend Phase 0 Architecture Baseline

This document records the repository state inspected for Phase 0. It separates the
existing architecture from the small foundation changes made in this phase. It is
not a proposal for the later design-system, application-shell, or feature phases.

## Current state

### Application structure

- `frontend` is an npm workspace running Next.js 16 with React 19.
- The app uses the Next.js App Router under `frontend/app`.
- Existing routes are the landing page, sign-in, sign-up, dashboard, problem list,
  and problem detail/workspace routes.
- `app/layout.tsx` is the root layout. It mounts `AuthProvider`, `Header`, and
  `Toaster` around route content.
- Pages that use state, effects, browser APIs, Monaco, or event streams are client
  components. There are no route-level server data loaders in the current app.
- Route groups are used for authentication pages: `app/(auth)/signin` and
  `app/(auth)/signup`.

### UI structure and styling

- Shared UI primitives currently live in `frontend/components/ui`.
- `Header` is the only general shared application component outside the UI
  primitives.
- Page-specific markup and state live directly in the route `page.tsx` files.
- Styling uses Tailwind CSS v4 with CSS variables in `app/globals.css`.
- `components.json` identifies the shadcn/base-nova style, but Phase 0 does not
  change the existing visual system or add primitives.

### Data flow

```text
Page or context
       |
       v
Browser fetch request (previously page-local; now api client for migrated calls)
       |
       v
NEXT_PUBLIC_BACKEND_URL + /api/v1/*
       |
       v
Express routes, middleware, and services
       |
       v
Direct JSON object responses or { message } errors
       |
       v
React state, context state, toasts, and rendered page data
```

The problem workspace also consumes the backend SSE endpoint directly through
`EventSource` for `submission.completed` notifications. SSE remains direct
because it is a streaming transport rather than a JSON request.

### Authentication

- Authentication is a JWT stored by the backend in the `auth_token` httpOnly
  cookie.
- The frontend does not read or store the token. Requests use
  `credentials: "include"` so the browser sends the cookie.
- `AuthProvider` calls `GET /api/v1/user` on mount and stores the returned user in
  React context. `useAuth` exposes that context.
- Sign-in and sign-up call the corresponding auth endpoints; sign-in refreshes
  the context after the cookie is set.
- Sign-out calls `POST /api/v1/auth/signout`.
- Backend protected routes use the cookie in `authMiddleware`; the frontend has
  no route guard or role-based navigation in the current state.

### API integration and backend contracts

The backend is mounted at `/api/v1` and currently exposes:

- `auth`: `POST /signup`, `POST /signin`, `POST /signout`
- `user`: authenticated `GET /`, `GET /stats`
- `questions`: `GET /`, `GET /:slug`
- `submissions`: authenticated `POST /:questionId`, `GET /:submissionId`,
  `GET /question/:questionId`
- `contests`: public listing/details plus authenticated registration,
  problems, submissions, and standings endpoints
- `events`: authenticated `GET /stream` SSE

Responses are not wrapped in a universal envelope. Examples include
`{ user }`, `{ questions, message }`, `{ question, message }`,
`{ submission }`, direct stats objects, and submission creation objects such as
`{ submissionId, status }`.

The backend returns JSON errors with a `message` field. Authentication failures
are normally 401 or 403; application errors may be 400, 404, 409, 429, 503, or
500. Authentication propagation is cookie-based and CORS is configured with
credentials.

### Shared contracts

The backend/shared package is JavaScript and contains canonical runtime
contracts, including submission status and verdict constants in
`packages/shared/contracts/verdicts.js`. It does not currently publish
TypeScript declarations for frontend consumption.

Before Phase 0, stable frontend DTOs were repeated in page files:
`Problem`, `Submission`, `Difficulty`, and dashboard statistics each had local
interfaces. Phase 0 adds TypeScript API DTOs in `frontend/types/api.ts`, based on
the inspected backend responses. Runtime backend enums remain owned by the
shared JavaScript contract; the frontend type unions describe the values it
receives without importing a JavaScript module as a type source.

### Testing

- Before Phase 0 there was no frontend test runner, test script, or frontend test
  directory.
- Backend and worker tests use Node scripts and are outside this frontend scope.
- Phase 0 adds Vitest with jsdom, Testing Library matchers, a setup file, and
  API-client smoke tests. No Phase 8 coverage target is attempted.

### Build and tooling

- npm workspaces are defined at the repository root.
- Frontend scripts before Phase 0 were `dev`, `build`, `start`, and `lint`.
- TypeScript is strict with the `@/*` alias mapped to the frontend directory.
- ESLint uses `eslint-config-next` with the flat config format.
- Tailwind uses the CSS-first v4/PostCSS setup.
- There is no repository-wide formatter configured.

## Phase 0 changes

### FE-001: reconnaissance

- Added this current-state architecture baseline under
  `docs/reconnaissance/`.
- Documented application structure, styling, data flow, authentication, API
  behavior, shared contracts, testing, and tooling.
- Explicitly separated current state from Phase 0 changes and did not document
  future architecture as existing behavior.

### FE-002: shared frontend types

- Added `frontend/types/api.ts` with user, auth, problem, submission, verdict,
  status, pagination, error, and dashboard DTOs.
- Replaced duplicate page/context interfaces in the existing low-risk consumers.
- Contest DTOs are not invented because the current frontend has no contest
  consumers; the backend routes are documented for future phases.

### FE-003: API client

- Added `frontend/lib/api-client.ts`.
- It resolves `NEXT_PUBLIC_BACKEND_URL`, normalizes trailing slashes, sends JSON
  bodies, defaults requests to cookie credentials, parses JSON responses, and
  throws `ApiError` with the HTTP status and backend error body.
- Migrated auth context, sign-in, sign-up, problem list, problem detail,
  submission polling, submission event refresh, submission creation, and
  dashboard stats.
- The remaining low-level request is the intentional `EventSource` connection
  for the backend SSE stream.

### FE-004: scripts and test infrastructure

- Added frontend `typecheck` and `test` scripts.
- Added root `dev:frontend`, `typecheck:frontend`, `lint:frontend`,
  `test:frontend`, and `build:frontend` workspace scripts.
- Added Vitest/jsdom setup and API-client smoke tests.

## Deliberately out of scope

Phase 0 does not activate a dark theme, change colors, add Phase 1 visual
constants, redesign buttons/header/toasts, add global empty/error/page-container
components, add new shadcn primitives, add route protection, or migrate
unrelated backend/worker code.
