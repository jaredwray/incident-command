# Deployment

Incident Command is one Next.js server (standalone output). Run it as a container on any host, or on Cloudflare Workers through OpenNext.

| Path             | What it serves                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `/`              | Public status page                                                                                                                |
| `/manage`        | Management portal                                                                                                                 |
| `/api/mcp`       | MCP server for AI agents (Streamable HTTP; bearer tokens `icmd_...` created in the portal)                                        |
| `/api/v1/status` | Public status JSON                                                                                                                |
| `/healthz`       | Health check: `200` with `"status":"ok"` (`"degraded"` while the database is down after boot), or `503` when the app cannot start |

## Quick start

```bash
cp .env.example .env              # set SITE_URL and SETUP_TOKEN
docker compose up -d --build      # app + Postgres 17
curl http://localhost:3000/healthz
```

## Provider guides

| Provider                              | Guide                                                   | Runs as                                     | Recommended database                                 | Notes                                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker / VPS, Fly.io, Render, Railway | [deploy/docker](../deploy/docker/README.md)             | Container                                   | Postgres (bundled in Compose)                        | Simplest. Compose file at the repo root.                                                                                                             |
| DigitalOcean App Platform             | [deploy/digitalocean](../deploy/digitalocean/README.md) | Container built from the Dockerfile         | Managed Postgres (in `app.yaml`)                     | `doctl apps create --spec deploy/digitalocean/app.yaml`.                                                                                             |
| Google Cloud Run                      | [deploy/gcp](../deploy/gcp/README.md)                   | Container (`gcloud run deploy --source .`)  | Cloud SQL for PostgreSQL, or MongoDB Atlas           | Secrets in Secret Manager; use `--min-instances=1`.                                                                                                  |
| AWS App Runner / ECS Fargate          | [deploy/aws](../deploy/aws/README.md)                   | Container image in ECR                      | RDS for PostgreSQL (DocumentDB: test first)          | SES email through the IAM role.                                                                                                                      |
| Azure Container Apps                  | [deploy/azure](../deploy/azure/README.md)               | Container (`az containerapp up --source .`) | PostgreSQL Flexible Server, or Cosmos DB for MongoDB | Use `--min-replicas 1`.                                                                                                                              |
| Cloudflare Workers                    | [deploy/cloudflare](../deploy/cloudflare/README.md)     | OpenNext Worker                             | Postgres through Hyperdrive, or MongoDB              | Status page, portal and MCP work; subscriber notifications are not sent ([details](../deploy/cloudflare/README.md)). Memory store for previews only. |

## Databases

The adapter is picked from `DATABASE_URI` (or forced with `STORE`):

| `DATABASE_URI`                     | Store                                                                                 | Use for                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `postgres://…` or `postgresql://…` | Postgres. Tables (prefix `DATABASE_TABLE_PREFIX`, default `ic_`) are created on boot. | Production (recommended)                                                              |
| `mongodb://…` or `mongodb+srv://…` | MongoDB. Database from the URL, or `DATABASE_NAME`.                                   | Production                                                                            |
| unset or `memory://`               | In-memory                                                                             | Development and demos only. Data is lost on restart and not shared between instances. |

The Postgres user must be able to create tables. On Postgres 15+ that means owning the database or having `CREATE` on its schema; the setups in these guides already do.

Stores from older versions name services "components". On the first boot after the upgrade, the app renames the old tables or collections and their fields. This runs one time and keeps all data.

### TLS for Postgres

node-postgres currently treats `sslmode=require` as full certificate verification (`verify-full`). Pick the mode by how the database's certificate is issued:

| Database                                                                            | Add to `DATABASE_URI`                                                  |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Certificate chains to a public root (for example Azure Flexible Server)             | `?sslmode=verify-full`                                                 |
| Provider's own CA, not in Node's trust store (for example DigitalOcean, Amazon RDS) | `?uselibpqcompat=true&sslmode=require` (encrypted, chain not verified) |
| Unix socket (Cloud SQL on Cloud Run) or a private network (Compose)                 | nothing                                                                |

## First admin

Open `/manage/setup` and create the admin there. Set `SETUP_TOKEN` so the page requires that token. Without it, whoever reaches the page first becomes admin.

## Health checks, caching and scaling

- Reads go through an in-process cache. `CACHE_TTL` (default `30s`) is how long cached reads stay fresh. If the database goes offline, the last known data keeps being served (it does not expire while offline) and `/healthz` reports `"status":"degraded"` with a 200.
- The cache is per instance. With N instances, public reads can be up to `CACHE_TTL` stale on some of them; lower `CACHE_TTL` if that matters. Sessions and API tokens are not cached, so sign-outs and token revocations take effect immediately everywhere.
- `/healthz` returns 503 only when the app cannot start: invalid configuration, or a database that is unreachable at boot (startup is retried on the next request). A database outage after boot keeps it at 200, so platforms do not restart instances that are still serving cached data.
- Never run more than one instance on the in-memory store.
- Each instance keeps its own database connection pool; size the instance count against your database's connection limit.
- Build each release with the same `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`. Next.js salts the server action ids with it. Without it, a deploy changes every id, and a portal page that a browser loaded before the deploy shows "This page is out of date" on its next form submit.

## Notifications

- **Webhooks** always work. With `WEBHOOK_SECRET` set, each request carries `x-incident-command-signature: sha256=<hex>`, the HMAC-SHA256 of the raw JSON body keyed with the secret.
- **Email** needs `EMAIL_FROM` plus one provider:
  - SendGrid: `SENDGRID_API_KEY`, `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` (airhorn's Twilio provider sends through SendGrid).
  - AWS SES: `AWS_SES_REGION` (or `AWS_REGION` with `EMAIL_PROVIDER=ses`), with `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` or the platform's IAM role.
- `SITE_URL` is used to build the links in notifications, so set it to the public URL.

## Environment variables

All are optional, and empty values are treated as unset. Durations accept `ms`, `s`, `m`, `h`, `hr` or `d` (for example `30s`, `15m`, `7d`), or plain milliseconds. A commented template is in [`.env.example`](../.env.example).

| Name                                 | Default                     | Description                                                                                                                                                           |
| ------------------------------------ | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Build**                            |                             |                                                                                                                                                                       |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | new key on each build       | Set it for `next build`. Next.js salts the server action ids and encrypts action closures with it. Make one with `openssl rand -base64 32` and use it for each build. |
| **Server**                           |                             |                                                                                                                                                                       |
| `PORT`                               | `3000`                      | Port the server listens on.                                                                                                                                           |
| `HOSTNAME`                           | `0.0.0.0` in the image      | Bind address. Containers must use `0.0.0.0`.                                                                                                                          |
| **Site**                             |                             |                                                                                                                                                                       |
| `SITE_URL`                           | unset                       | Public URL of the status page, used in notification links. A trailing slash is removed.                                                                               |
| `SITE_NAME`                          | `Status`                    | Initial site name; editable in the portal.                                                                                                                            |
| **Storage**                          |                             |                                                                                                                                                                       |
| `DATABASE_URI`                       | unset (memory)              | `postgres://`, `postgresql://`, `mongodb://`, `mongodb+srv://` or `memory://`.                                                                                        |
| `STORE`                              | from `DATABASE_URI`         | Force the adapter: `memory`, `postgres` or `mongo`.                                                                                                                   |
| `DATABASE_NAME`                      | database in the URL         | MongoDB database name.                                                                                                                                                |
| `DATABASE_TABLE_PREFIX`              | `ic_`                       | Postgres table name prefix.                                                                                                                                           |
| `DATABASE_POOL`                      | `true` (`false` on Workers) | Keep a database connection pool. `false` opens a connection per operation (Workers).                                                                                  |
| `SEED_DEMO`                          | `false`                     | `true` or `1` seeds demo services and incidents on boot when the store has no services.                                                                               |
| **Cache**                            |                             |                                                                                                                                                                       |
| `CACHE_TTL`                          | `30s`                       | How long cached reads stay fresh. Cached data keeps being served while the database is offline.                                                                       |
| `CACHE_MAX_ENTRIES`                  | `5000`                      | Maximum cache entries per instance.                                                                                                                                   |
| **Portal access**                    |                             |                                                                                                                                                                       |
| `SESSION_TTL`                        | `7d`                        | Portal session lifetime.                                                                                                                                              |
| `SETUP_TOKEN`                        | unset                       | When set, required to create the first admin at `/manage/setup`.                                                                                                      |
| **Notifications**                    |                             |                                                                                                                                                                       |
| `WEBHOOK_SECRET`                     | unset                       | Signs webhook payloads (`x-incident-command-signature: sha256=<hex>`).                                                                                                |
| `EMAIL_FROM`                         | unset                       | Sender address. Email is disabled without it.                                                                                                                         |
| `EMAIL_PROVIDER`                     | auto                        | `sendgrid` or `ses`. Auto: `sendgrid` if `SENDGRID_API_KEY` is set, else `ses` if `AWS_SES_REGION` is set.                                                            |
| `SENDGRID_API_KEY`                   | unset                       | SendGrid API key (needs the two Twilio variables too).                                                                                                                |
| `TWILIO_ACCOUNT_SID`                 | unset                       | Twilio account SID, required for SendGrid email.                                                                                                                      |
| `TWILIO_AUTH_TOKEN`                  | unset                       | Twilio auth token, required for SendGrid email.                                                                                                                       |
| `AWS_SES_REGION`                     | unset                       | SES region; takes precedence over `AWS_REGION`.                                                                                                                       |
| `AWS_REGION`                         | unset                       | Fallback SES region.                                                                                                                                                  |
| `AWS_ACCESS_KEY_ID`                  | unset                       | SES credentials; when unset the AWS default credential chain (IAM role) is used.                                                                                      |
| `AWS_SECRET_ACCESS_KEY`              | unset                       | SES credentials, paired with `AWS_ACCESS_KEY_ID`.                                                                                                                     |
