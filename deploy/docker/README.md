# Deploy with Docker (any VPS or container host)

The repo's [`Dockerfile`](../../Dockerfile) builds a small Node 24 image that runs the Next.js standalone server on port 3000 as a non-root user. Anything that runs a container can host it.

## Prerequisites

- Docker 24+ with Compose v2 (`docker compose version`).
- A Postgres or MongoDB database, or use the bundled Compose stack.

## Option 1: Docker Compose (app + Postgres on one host)

```bash
git clone https://github.com/jaredwray/incident-command.git
cd incident-command
cp .env.example .env        # set SITE_URL and SETUP_TOKEN at least
docker compose up -d --build
docker compose logs -f app
```

[`docker-compose.yml`](../../docker-compose.yml) starts the app and `postgres:17-alpine` with a named volume. Inside Compose, use service names (`postgres`, `mongo`) in `DATABASE_URI`, not `localhost`.

MongoDB instead: set `DATABASE_URI=mongodb://mongo:27017/incident_command` in `.env`, then `docker compose --profile mongo up -d --build`.

Upgrade: `git pull && docker compose up -d --build`. Back up the database volume (for example `docker compose exec postgres pg_dump -U incident incident_command > backup.sql`).

## Option 2: Plain Docker

```bash
docker build -t incident-command .
docker run -d --name incident-command --restart unless-stopped -p 3000:3000 \
  -e DATABASE_URI='postgres://USER:PASSWORD@DB_HOST:5432/incident_command' \
  -e SITE_URL=https://status.example.com \
  -e SETUP_TOKEN='CHOOSE_A_LONG_TOKEN' \
  incident-command
```

Or keep settings in a file: `docker run --env-file .env ...`.

### TLS on a VPS

Put a reverse proxy in front of port 3000. With [Caddy](https://caddyserver.com/) (automatic HTTPS):

```bash
caddy reverse-proxy --from status.example.com --to localhost:3000
```

## Other container hosts

These platforms build the `Dockerfile` straight from the repo. Point their health check at `/api/health`, set the variables below as secrets, and attach a managed Postgres.

### Fly.io

```bash
fly launch --no-deploy        # detects the Dockerfile; internal_port = 3000
fly secrets set DATABASE_URI='postgres://...' SITE_URL=https://<app>.fly.dev \
  SETUP_TOKEN='CHOOSE_A_LONG_TOKEN'
fly deploy
```

Create or attach a Postgres database first, and add an `[[http_service.checks]]` block with `path = "/api/health"` to `fly.toml`.

### Render

New **Web Service** from the repo with runtime **Docker**. Create a Render Postgres and set `DATABASE_URI` to its Internal Database URL. Health Check Path: `/api/health`.

### Railway

New project from the GitHub repo (the Dockerfile is detected). Add a **PostgreSQL** service, set `DATABASE_URI=${{Postgres.DATABASE_URL}}` on the app, and set the healthcheck path to `/api/health`.

### Notes

These hosts set `PORT` themselves; the server listens on whatever `PORT` says. If a host overrides `HOSTNAME`, set `HOSTNAME=0.0.0.0` explicitly.

## Required environment variables

| Variable       | Notes                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------ |
| `DATABASE_URI` | `postgres://…` or `mongodb://…`. Unset means the in-memory store: data is lost on restart. |
| `SITE_URL`     | Public URL, used in notification links.                                                    |
| `SETUP_TOKEN`  | Required to create the first admin at `/manage/setup`.                                     |

Optional: `WEBHOOK_SECRET`, email settings, cache and session tuning. Full list: [docs/deployment.md](../../docs/deployment.md#environment-variables).

## First admin

Open `https://<host>/manage/setup` and create the admin. Set `SETUP_TOKEN` first. Without it, whoever reaches the page first becomes admin.

## Verify

```bash
curl http://localhost:3000/api/health
# {"status":"ok","store":{...}}   ("degraded" while the database is down; 503 if the app cannot start)
curl http://localhost:3000/api/v1/status
docker inspect --format '{{.State.Health.Status}}' incident-command   # healthy / unhealthy
```

## Scaling

- Instances keep no state on disk; run as many as you like behind a load balancer, all pointing at the same database. Never scale out with the in-memory store: each instance would have its own data.
- Each instance has its own in-process cache, so with several instances public reads can be up to `CACHE_TTL` (default `30s`) stale. Lower it if that matters. Sessions and API tokens are not cached.
- If the database goes offline, each instance keeps serving its last known data and `/api/health` reports `"status":"degraded"` with a 200, so the container stays healthy. It returns 503 only when the app cannot start.
