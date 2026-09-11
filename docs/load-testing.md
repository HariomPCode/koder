# Koder load testing

`npm run load:test` runs the repository's dependency-free Node load harness. It
was chosen for ISSUE-134 because it can generate normal HTTP traffic and maintain
authenticated SSE connections without adding a second load-testing runtime.

The harness implements the four roadmap scenarios:

| Scenario | Users | Target submissions/s | SSE connections |
|---|---:|---:|---:|
| 1 | 100 | 0.6 | 100 |
| 2 | 1,000 | 6 | 1,000 |
| 3 | 5,000 | 30 | 5,000 |
| 4 | 10,000 | 60 | 10,000 |

Each run exercises liveness, readiness, metrics, contest listing, authenticated
stats, optional practice submissions, and optional contest standings. When
`LOAD_TEST_AUTH_COOKIE` is supplied, it also opens SSE connections and closes them
after the run to exercise connection churn. Local execution caps active SSE
connections at `LOAD_TEST_MAX_CONCURRENCY` by default so a Docker Desktop run does
not accidentally exhaust the host.

When a question ID is supplied, each submission is followed through the existing
submission endpoint until it first becomes `RUNNING`. Queue wait is measured from
the persisted `createdAt` timestamp to the persisted `RUNNING` transition; this
uses the existing lifecycle and does not add application instrumentation. Queue
depth is sampled from the existing `koder_queue_jobs` metrics.

During the run, the harness also samples MongoDB `serverStatus()` through the
existing Compose MongoDB container and Redis memory information through
`redis-cli INFO memory` in the existing Compose Redis container. Optional worker
container CPU/memory is collected from `docker stats` when
`LOAD_TEST_WORKER_CONTAINER` is set. The repository starts workers as host Node
processes rather than Docker containers, so worker CPU/memory is otherwise
reported as unavailable.

## Running

```powershell
$env:LOAD_TEST_SCENARIO = "1"
$env:LOAD_TEST_DURATION_SECONDS = "60"
$env:LOAD_TEST_MAX_CONCURRENCY = "25"
$env:LOAD_TEST_AUTH_COOKIE = "auth_token=..."
$env:LOAD_TEST_QUESTION_ID = "<question-id>"
$env:LOAD_TEST_SSE = "false"
npm run load:test
```

Useful controls are `LOAD_TEST_BASE_URL`, `LOAD_TEST_MAX_CONCURRENCY`,
`LOAD_TEST_SSE=false`, `LOAD_TEST_CODE`, `LOAD_TEST_TELEMETRY_INTERVAL_MS`,
`LOAD_TEST_QUEUE_WAIT_TIMEOUT_MS`, and `LOAD_TEST_WORKER_CONTAINER`. The command
prints JSON containing throughput, p50/p95/p99 latency, queue-wait percentiles,
status counts, error rate, per-path results, queue depth, infrastructure
observations, and SSE connection counts. It exits non-zero when the error rate
exceeds 0.1%.

The proposed roadmap thresholds are p95 non-judge API latency below 300 ms,
peak enqueue-to-running wait below 10 seconds, error rate below 0.1% excluding
intentional 403/429 responses, and no leaderboard inconsistencies. The harness
does not claim production capacity: results from Docker Desktop are local
observations and should be repeated on production-like infrastructure with queue
wait and host resource telemetry.

## Sustained local observation

On 2026-09-11, Scenario 1 was run for 20 seconds with five concurrent load
workers, authenticated HTTP traffic, 12 JavaScript submissions, the existing
Compose MongoDB/Redis services, and one host Node.js JavaScript worker. The run
completed 707 requests with 0% errors and 21.52 requests/second. Overall latency
was p50 38.06 ms, p95 328.85 ms, and p99 615.34 ms. The one observed
enqueue-to-`RUNNING` sample was 165 ms; the worker completed some submissions
before the first status poll, so this is a lower-confidence sample rather than a
complete queue-wait distribution.

Queue depth stayed at zero waiting jobs and at most one active JavaScript job in
the telemetry samples. MongoDB reported no rejected connections, with roughly
47-50 current connections and resident memory around 229-230 MB. Redis was
available throughout the run. Worker CPU and memory were not measured because
the worker runs as a host Node.js process rather than a Docker container.

The same run showed `/api/v1/user/stats` p95 of 788.03 ms, but this local sample
does not establish that `/stats` is a production bottleneck: it used one user,
small data, Docker Desktop, and modest concurrency. It is evidence for further
profiling, not a trigger to add ISSUE-135 counters.
