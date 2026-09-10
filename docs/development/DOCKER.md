# Local infrastructure with Docker Compose

Koder runs the backend, workers, and frontend directly on the host. Docker
Compose provides the shared local infrastructure only: MongoDB and Redis. The
untrusted-code containers created by `DockerSandbox` remain separate from this
stack.

## Start from a clean clone

```powershell
Copy-Item .env.example .env
Copy-Item .env.example backend/.env
docker compose up -d mongo redis
npm install
node backend/seedProblems.js
npm run dev:backend
npm run worker:js
npm run worker:java
npm run worker:python
npm run dev --workspace=frontend
```

The backend and workers load the root `.env` file. `seedProblems.js` and
`promoteAdmin.js` explicitly load `backend/.env`, which is why the setup above
copies the template there as well. The frontend reads `NEXT_PUBLIC_BACKEND_URL`
from the environment when it is started.

MongoDB and Redis persist data in named Docker volumes. Starting Compose does
not seed or delete application data. Run `node backend/seedProblems.js`
explicitly when the problem set needs initialization or refresh.

## Services and ports

| Service | Host address | Purpose |
| --- | --- | --- |
| MongoDB | `127.0.0.1:27017` | Backend, workers, and seed script |
| Redis | `127.0.0.1:6379` | BullMQ queues for backend and workers |
| Backend | `http://localhost:5000` | Host-run backend |
| Frontend | `http://localhost:3000` | Host-run frontend |

MongoDB and Redis bind only to loopback. Compose creates its default isolated
network for the infrastructure services. No privileged containers or Docker
socket mounts are used.

The host-run workers create the submission containers, so Docker daemon access
is trusted infrastructure. Do not expose the Docker daemon to application users
or add `privileged`, host networking, host filesystem mounts, or Docker-socket
mounts to submission containers. The worker applies its own container controls
(`--network none`, non-root UID, read-only root, dropped capabilities, PID/CPU/
memory limits); Docker's built-in seccomp profile must remain enabled.

## Worker capacity budgeting

Each judge container is limited to 1 CPU, 256 MiB of memory, and 64 PIDs.
Worker concurrency must therefore be selected from the capacity of the host,
not from queue demand alone. The worker fleet shares one Redis-backed active
execution budget across JavaScript, Java, and Python workers.

The relevant environment variables are:

| Variable | Scope | Default |
| --- | --- | --- |
| `KODER_WORKER_CONCURRENCY_JS` | BullMQ concurrency for the JavaScript worker | `1` |
| `KODER_WORKER_CONCURRENCY_JAVA` | BullMQ concurrency for the Java worker | `1` |
| `KODER_WORKER_CONCURRENCY_PYTHON` | BullMQ concurrency for the Python worker | `1` |
| `WORKER_MAX_ACTIVE_JOBS` | Shared host-wide active execution budget | `4` |
| `KODER_WORKER_MAX_ACTIVE_JOBS` | Alias for the shared host-wide budget | `4` |

`WORKER_MAX_ACTIVE_JOBS` is shared by every language worker using the same
capacity domain. It is not a per-language limit. The admission guard rejects
work above the limit before Docker execution starts; BullMQ then applies its
normal retry/backoff behavior. Keep the sum of configured language concurrency
values at or below the validated host budget to avoid avoidable capacity
retries.

### Conservative starting profiles

These are deployment starting points, not universal guarantees. Leave headroom
for the operating system, Docker, Redis, MongoDB, and worker processes:

| Host class | Minimum practical resources | Recommended `WORKER_MAX_ACTIVE_JOBS` | Recommended total language concurrency |
| --- | --- | ---: | ---: |
| Development | 2 CPU cores, 4 GiB RAM | `1` | `1` |
| Standard worker | 4 CPU cores, 8 GiB RAM | `3` | `3` |
| High-capacity worker | 8 CPU cores, 16 GiB RAM | `6` | `6` |

Use one shared budget across all language workers on a host. For example, a
standard worker can use `KODER_WORKER_CONCURRENCY_JS=1`,
`KODER_WORKER_CONCURRENCY_JAVA=1`, and
`KODER_WORKER_CONCURRENCY_PYTHON=1` with
`WORKER_MAX_ACTIVE_JOBS=3`. Do not independently assign the full host budget
to each language.

Before increasing a production value, run the capacity benchmark in
`workers/tests/ci/test_worker_capacity.js` and repeat the measurement with
real Docker judge workloads on the target host class. The checked-in harness
uses a fake sandbox and records throughput, duration, load average, memory
delta, and errors; it is useful for comparison but is not a production
capacity certification. Increase the budget only when the target host remains
within its CPU and memory headroom with zero execution errors, then record the
approved values with the deployment configuration.

The shared budget depends on Redis. If Redis is unavailable, workers fail
closed before starting new judge containers. The active counter is intended
for workers sharing one host capacity domain; do not combine unrelated hosts
under one budget without explicitly planning that topology.

Stop the services with:

```powershell
docker compose down
```

To remove persisted local data, use the explicit destructive command:

```powershell
docker compose down -v
```
