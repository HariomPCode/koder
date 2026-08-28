# Local infrastructure with Docker Compose

Koder runs the backend, workers, and frontend directly on the host. Docker
Compose provides the shared local infrastructure only: MongoDB and Redis. The
untrusted-code containers created by `DockerSandbox` remain separate from this
stack.

## Start from a clean clone

```powershell
Copy-Item .env.example .env
docker compose up -d mongo redis
npm install
node backend/seedProblems.js
npm run dev:backend
npm run worker:js
npm run worker:java
npm run dev --workspace=frontend
```

The backend and workers load the root `.env` file. The frontend reads
`NEXT_PUBLIC_BACKEND_URL` from the environment when it is started.

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

Stop the services with:

```powershell
docker compose down
```

To remove persisted local data, use the explicit destructive command:

```powershell
docker compose down -v
```
