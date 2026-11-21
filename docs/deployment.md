# Deployment

Incident Command is one Next.js server (standalone output). Run it as a container on any host, or on Cloudflare Containers behind a Worker.

| Path                 | What it serves                                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                  | Public status page                                                                                                                     |
| `/manage`            | Management portal                                                                                                                      |
| `/api/mcp`           | MCP server for AI agents (Streamable HTTP; bearer tokens `icmd_...` created in the portal)                                             |
| `/api/v1/status`     | Public status JSON                                                                                                                     |
| `/feed.xml`          | RSS feed. Each incident and maintenance update is one item.                                                                            |
| `/llms.txt`          | The status page in Markdown, for agents ([llms.txt](https://llmstxt.org))                                                              |
| `/history.md`        | The incident history in Markdown. `?month=YYYY-MM` selects the newest month. The history starts at the month of the earliest incident. |
| `/incidents/{id}.md` | An incident page in Markdown                                                                                                           |
| `/healthz`           | Health check: `200` with `"status":"ok"` (`"degraded"` while the database is down after boot), or `503` when the app cannot start      |

## Quick start

```bash
cp .env.example .env              # set SITE_URL and SETUP_TOKEN
docker compose up -d --build      # app + Postgres 17
curl http://localhost:3000/healthz
```

## Provider guides

| Provider                              | Guide                                                   | Runs as                                      | Recommended database                                           | Notes                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Docker / VPS, Fly.io, Render, Railway | [deploy/docker](../deploy/docker/README.md)             | Container                                    | Postgres (bundled in Compose)                                  | Simplest. Compose file at the repo root.                                                                                 |
| DigitalOcean App Platform             | [deploy/digitalocean](../deploy/digitalocean/README.md) | Container built from the Dockerfile          | Managed Postgres (in `app.yaml`)                               | `doctl apps create --spec deploy/digitalocean/app.yaml`.                                                                 |
| Google Cloud Run                      | [deploy/gcp](../deploy/gcp/README.md)                   | Container (`gcloud run deploy --source .`)   | Cloud SQL for PostgreSQL, or MongoDB Atlas                     | Secrets in Secret Manager; use `--min-instances=1`.                                                                      |
| AWS App Runner / ECS Fargate          | [deploy/aws](../deploy/aws/README.md)                   | Container image in ECR                       | RDS for PostgreSQL (DocumentDB: test first)                    | SES email through the IAM role.                                                                                          |
| Azure Container Apps                  | [deploy/azure](../deploy/azure/README.md)               | Container (`az containerapp up --source .`)  | PostgreSQL Flexible Server, or Cosmos DB for MongoDB           | Use `--min-replicas 1`.                                                                                                  |
| Cloudflare Containers                 | [deploy/cloudflare](../deploy/cloudflare/README.md)     | Container behind a Worker (`pnpm cf:deploy`) | Postgres or MongoDB that accepts connections from the internet | An idle container stops after `CONTAINER_SLEEP_AFTER`; the next request starts it again. Memory store for previews only. |

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
- The cache is per instance. With N instances, public reads can be up to `CACHE_TTL` stale on some of them; lower `CACHE_TTL` if that matters. API tokens are not cached, so token revocations take effect immediately everywhere.
- Each instance keeps a resolved portal session in memory for `SESSION_CACHE_TTL` (default `30s`), so most portal page views do not read the session from the database. On the instance that gets a sign-out or a member change, the change applies immediately. On a different instance, a page view can use the old session or the old role for `SESSION_CACHE_TTL`, at most. A server action always reads the session and the member from the database, so an old session cannot change data. Set `SESSION_CACHE_TTL=0` to turn this cache off.
- `/healthz` returns 503 only when the app cannot start: invalid configuration, or a database that is unreachable at boot (startup is retried on the next request). A database outage after boot keeps it at 200, so platforms do not restart instances that are still serving cached data.
- Never run more than one instance on the in-memory store.
- Each instance keeps its own database connection pool; size the instance count against your database's connection limit.
- Build each release with the same `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`. Next.js salts the server action ids with it. Without it, a deploy changes every id, and a portal page that a browser loaded before the deploy shows "This page is out of date" on its next form submit.

## Notification queue

An admin selects one queue in **Manage → Settings → Notifications**, or no queue.

- With no queue, a window shows the status of each notification when you send.
- With a queue, the incident dashboard shows a progress bar. The bar updates until the queue is done.
- The providers are Redis, RabbitMQ and NATS. Select one.
- Each provider keeps the tasks. NATS needs JetStream.
- The queue runs in the Node server. A Cloudflare Worker does not run the queue. The container does.
- After a restart, the server continues a job that stopped.

## Notifications

Admins set up notifications in **Manage → Settings → Notifications**. Incident Command sends them through [airhorn](https://airhorn.org).

- There are three channels: webhooks, email and text messaging. Each channel has an on/off switch.
- Webhooks have only the on/off switch. The server sends each webhook, so webhooks have no providers, no delivery strategy and no sender.
- Email and text messaging can have more than one provider:
  - Email: SendGrid and Amazon SES.
  - Text messaging: Twilio and Amazon SNS.
- Email and text messaging have a delivery strategy:
  - **Active/passive** (airhorn fail-over): the first provider sends. When a send fails, the next provider sends. Use **Move up** and **Move down** to set the order.
  - **Load balanced** (airhorn round-robin): each message goes through the next provider in turn. A failed send does not go to a different provider.
- Email and text messages need a sender. Set a default sender on the channel, or a sender on each provider. A sender on a provider replaces the sender of the channel.
- A webhook posts only to public internet addresses. The server refuses a URL whose host is, or resolves to, a private, loopback, link-local or reserved address. It does not follow redirects. To post to a webhook inside your own network, turn on **Allow private network addresses** in **Manage → Settings → Notifications → Webhooks**.
- When `WEBHOOK_SECRET` is set, each webhook request has the header `x-incident-command-signature: sha256=<hex>`. The value is the HMAC-SHA256 of the raw JSON body, keyed with `WEBHOOK_SECRET`.
- Amazon SNS takes a sender ID of up to 11 letters and digits. When the sender is a phone number, SNS sends it as the origination number. The number must be an origination number of your AWS account.
- The public subscribe page offers each channel that is on and can send: email, text message and webhook. To stop public sign-ups through a channel, turn that channel off. The channel sends a confirmation link to the address, phone number or URL. Notifications start only after a click on that link.
- A webhook confirmation has `"event": "subscription.confirm"`, `text`, `content` and `confirmUrl`. Slack and Discord show the text with the link.
- A visitor unsubscribes on `/subscribe/unsubscribe`. The visitor chooses the channel and enters the email address, phone number or webhook URL. The page gives the same answer when the address has no subscription. The link in each email opens the same page and unsubscribes with one click.
- Admins add subscribers in **Manage → Subscribers** or with the `add_subscriber` MCP tool. These subscribers get no confirmation. Get consent before you add a phone number.
- `SITE_URL` is used to build the links in notifications, so set it to the public URL.

### Encrypted provider credentials

The database keeps provider credentials (API keys, auth tokens and secret access keys) encrypted with AES-256-GCM. The key comes from the `ENCRYPTION_KEY` environment variable, so keep it in the secret store of your platform.

1. Make a key: `openssl rand -base64 32`.
2. Set it as `ENCRYPTION_KEY` (for example `npx wrangler secret put ENCRYPTION_KEY`, or a secret in Secret Manager, Secrets Manager or Key Vault).
3. Restart the server, then add providers in the portal.

Without `ENCRYPTION_KEY`, you can turn channels on and off and add providers that need no credentials, such as Amazon SES with an IAM role. You cannot save credentials.

- Each value is bound to its provider and field. A value that moves to a different field does not decrypt.
- The portal and the MCP server never show a saved credential again. Leave a credential field empty to keep the saved value.
- If the key changes or is lost, the portal shows the providers whose credentials do not decrypt. Enter those credentials again.

To change the key:

1. Set the new key as `ENCRYPTION_KEY` and the old key as `ENCRYPTION_KEY_PREVIOUS`.
2. Restart the server. The old key still decrypts the stored values.
3. Select **Save channel** on each channel that has providers. Each save encrypts the values of that channel again with the new key.
4. Remove `ENCRYPTION_KEY_PREVIOUS` and restart the server.

### Providers from environment variables

A channel without providers uses the providers from environment variables, so existing deployments continue to send. When you add a provider to a channel in the portal, that channel stops using them.

- Webhooks use the built-in webhook sender. It signs each request when `WEBHOOK_SECRET` is set.
- Email uses SendGrid when `SENDGRID_API_KEY` is set, or AWS SES when `AWS_SES_REGION` is set (or `AWS_REGION` with `EMAIL_PROVIDER=ses`). SES uses `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, or the IAM role of the platform.
- `EMAIL_FROM` is the default sender of the email channel, also for providers that you add in the portal.

## Environment variables

All are optional, and empty values are treated as unset. Durations accept `ms`, `s`, `m`, `h`, `hr` or `d` (for example `30s`, `15m`, `7d`), or plain milliseconds. A commented template is in [`.env.example`](../.env.example).

| Name                                 | Default                | Description                                                                                                                                                           |
| ------------------------------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Build**                            |                        |                                                                                                                                                                       |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | new key on each build  | Set it for `next build`. Next.js salts the server action ids and encrypts action closures with it. Make one with `openssl rand -base64 32` and use it for each build. |
| **Server**                           |                        |                                                                                                                                                                       |
| `PORT`                               | `3000`                 | Port the server listens on.                                                                                                                                           |
| `HOSTNAME`                           | `0.0.0.0` in the image | Bind address. Containers must use `0.0.0.0`.                                                                                                                          |
| **Site**                             |                        |                                                                                                                                                                       |
| `SITE_URL`                           | unset                  | Public URL of the status page, used in notification links. A trailing slash is removed.                                                                               |
| `SITE_NAME`                          | `Status`               | Initial site name; editable in the portal.                                                                                                                            |
| **Storage**                          |                        |                                                                                                                                                                       |
| `DATABASE_URI`                       | unset (memory)         | `postgres://`, `postgresql://`, `mongodb://`, `mongodb+srv://` or `memory://`.                                                                                        |
| `STORE`                              | from `DATABASE_URI`    | Force the adapter: `memory`, `postgres` or `mongo`.                                                                                                                   |
| `DATABASE_NAME`                      | database in the URL    | MongoDB database name.                                                                                                                                                |
| `DATABASE_TABLE_PREFIX`              | `ic_`                  | Postgres table name prefix.                                                                                                                                           |
| `DATABASE_POOL`                      | `true`                 | Keep a database connection pool. `false` opens a connection for each query (Postgres) or each operation (MongoDB).                                                    |
| `SEED_DEMO`                          | `false`                | `true` or `1` seeds demo services and incidents on boot when the store has no services.                                                                               |
| **Cache**                            |                        |                                                                                                                                                                       |
| `CACHE_TTL`                          | `30s`                  | How long cached reads stay fresh. Cached data keeps being served while the database is offline.                                                                       |
| `CACHE_MAX_ENTRIES`                  | `5000`                 | Maximum cache entries per instance.                                                                                                                                   |
| `SESSION_CACHE_TTL`                  | `30s`                  | How long an instance keeps a resolved portal session in memory. `0` turns the session cache off.                                                                      |
| **Portal access**                    |                        |                                                                                                                                                                       |
| `SESSION_TTL`                        | `7d`                   | Portal session lifetime.                                                                                                                                              |
| `SETUP_TOKEN`                        | unset                  | When set, required to create the first admin at `/manage/setup`.                                                                                                      |
| **Notifications**                    |                        |                                                                                                                                                                       |
| `ENCRYPTION_KEY`                     | unset                  | Encrypts provider credentials in the database. Use at least 32 characters, for example `openssl rand -base64 32`. Required to save credentials in the portal.         |
| `ENCRYPTION_KEY_PREVIOUS`            | unset                  | Old keys, separated by commas. They decrypt stored values until a save encrypts them again with `ENCRYPTION_KEY`.                                                     |
| `EMAIL_FROM`                         | unset                  | Default sender of the email channel.                                                                                                                                  |
| `WEBHOOK_SECRET`                     | unset                  | Signs each webhook with HMAC-SHA256. When it is unset, the server sends unsigned webhooks.                                                                            |
| `EMAIL_PROVIDER`                     | auto                   | `sendgrid` or `ses`, for an email channel without providers. Auto: `sendgrid` if `SENDGRID_API_KEY` is set, else `ses` if `AWS_SES_REGION` is set.                    |
| `SENDGRID_API_KEY`                   | unset                  | SendGrid API key, for an email channel without providers.                                                                                                             |
| `AWS_SES_REGION`                     | unset                  | SES region; takes precedence over `AWS_REGION`.                                                                                                                       |
| `AWS_REGION`                         | unset                  | Fallback SES region.                                                                                                                                                  |
| `AWS_ACCESS_KEY_ID`                  | unset                  | SES credentials; when unset the AWS default credential chain (IAM role) is used.                                                                                      |
| `AWS_SECRET_ACCESS_KEY`              | unset                  | SES credentials, paired with `AWS_ACCESS_KEY_ID`.                                                                                                                     |
