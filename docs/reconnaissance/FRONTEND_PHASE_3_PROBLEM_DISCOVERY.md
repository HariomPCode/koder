# Frontend Phase 3 Problem Discovery Reconnaissance

## Current backend capability

`GET /api/v1/questions` accepts `page` and `limit`. The backend normalizes the
page and caps the limit at 100, then returns `{ message, questions }`. It does
not currently return a total count or total page count, and it does not accept
search, difficulty, or tag query parameters.

`GET /api/v1/questions/:slug` returns `{ message, question }` for an existing
problem. The detail response includes the problem metadata, description,
constraints, examples, tags, and starter code.

## Phase 3 implementation boundary

The discovery page now uses URL-driven `page` and `limit` values for the
unfiltered catalog. Previous and next navigation are intentionally based on
the response length because no total count is available. The UI does not
fabricate catalog totals.

Until backend filter support exists, search and difficulty filtering request
the backend maximum of 100 problems and filter that fetched window in the
browser. This limitation is stated in the UI. Filter changes reset the URL
page to 1.

## FE-032 reconnaissance and deferral

`frontend/app/problems/page.tsx` currently owns URL state and discovery
interactions, so it remains a client component for this phase.

`frontend/app/problems/[slug]/page.tsx` is a client component because it owns
Monaco editor state, language selection, panel resizing, submission requests,
polling, and the submission-completed event stream. The problem description
could eventually be rendered outside the client boundary, but doing so safely
requires the workspace decomposition in FE-040 first.

FE-032 is therefore **deferred — blocked by FE-040**. No Server Component
conversion, workspace decomposition, editor relocation, or submission-logic
relocation is part of Phase 3.
