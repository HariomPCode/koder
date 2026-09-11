# Rate limiting

Koder uses the existing BullMQ Redis connection for distributed fixed-window
rate limiting. Each request atomically increments a Redis counter and sets the
window expiry on the first increment. Keys contain only a bounded SHA-256
identity digest; raw IP addresses, user IDs, credentials, and request bodies are
never stored in Redis keys.

| Endpoint class | Identity | Default limit | Window | Redis failure |
|---|---|---:|---:|---|
| Signup and signin | Client IP | 10 | 60 seconds | Fail closed with 503 |
| Practice submissions | Authenticated user | 20 | 60 seconds | Fail open |
| Contest submissions | Authenticated user + contest | 30 | 60 seconds | Fail open |

Rejected requests return `429`, a bounded JSON message, `Retry-After`, and
`X-RateLimit-*` headers. Health, metrics, SSE, reads, and worker operations are
not rate limited. Submission idempotency and queue priority remain inside the
existing submission services and are unaffected.

All limits and windows are configurable through the `RATE_LIMIT_*` environment
variables documented in `.env.example`.
