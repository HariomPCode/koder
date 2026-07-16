# Backend APIs - v1

**Base URL:** `/api/v1`

## Authentication (`/auth`)

| Method | Endpoint   | Description                     |
| ------ | ---------- | ------------------------------- |
| POST   | `/signup`  | Register a new user             |
| POST   | `/signin`  | Authenticate user               |
| POST   | `/signout` | Sign out the authenticated user |

---

## User (`/user`)

| Method | Endpoint | Description                      |
| ------ | -------- | -------------------------------- |
| GET    | `/`      | Get authenticated user's profile |
| GET    | `/stats` | Get user statistics              |

---

## Questions (`/questions`)

| Method | Endpoint            | Description                        |
| ------ | ------------------- | ---------------------------------- |
| GET    | `/?page=1&limit=10` | Get paginated list of questions    |
| GET    | `/:questionId`      | Get details of a specific question |

---

## Submissions (`/submissions`)

| Method | Endpoint                | Description                                 |
| ------ | ----------------------- | ------------------------------------------- |
| POST   | `/:questionId`          | Submit solution for a question              |
| GET    | `/:jobId`               | Get submission status/result                |
| GET    | `/question/:questionId` | Get all submissions for a specific question |
