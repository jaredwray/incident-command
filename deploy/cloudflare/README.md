# Deploy to Cloudflare (Worker and Container)

The app runs on [Cloudflare Containers](https://developers.cloudflare.com/containers/). The container runs the image from the [`Dockerfile`](../../Dockerfile), which is the same Next.js server as on other container hosts. A Worker in front of the container gets each request and sends it to the container.

| File                                                                 | Content                                                         |
| -------------------------------------------------------------------- | --------------------------------------------------------------- |
| [`wrangler.jsonc`](../../wrangler.jsonc)                             | The Worker, the container, the Durable Object and the vars.     |
| [`cloudflare-worker.ts`](../../cloudflare-worker.ts)                 | The Worker entry. It exports the `AppContainer` Durable Object. |
| [`src/lib/cloudflare-worker.ts`](../../src/lib/cloudflare-worker.ts) | The logic of the Worker and the Durable Object.                 |
| [`scripts/wrangler-docker.sh`](../../scripts/wrangler-docker.sh)     | Gives `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` to the image build.  |

## How it works

```
 browsers, agents ─▶ Worker ─▶ AppContainer Durable Object ─▶ container (Next.js on port 3000)
                    (picks an     (starts the container,          │
                     instance)     sends each request)            ▼
                                                        Postgres or MongoDB, email, webhooks
```

1. The Worker picks an instance from the client address. Each client address always uses the same instance, so a client reads its own changes from the cache of that instance.
2. The `AppContainer` Durable Object of the instance starts the container on the first request. The container gets each var and each secret of the Worker as an environment variable, except the `CONTAINER_*` vars.
3. The Durable Object waits until the server answers on `/healthz`. Then it sends the request to the server. It sets `x-forwarded-host`, `x-forwarded-proto` and `x-forwarded-for`. Next.js compares the `Origin` of a server action with `x-forwarded-host`.
4. When no request comes for approximately `CONTAINER_SLEEP_AFTER` (default `30m`), Cloudflare stops the container. The next request starts it again. This start takes some seconds.
5. A deploy restarts the Durable Object. If the deploy changed the image, a var or a secret, the Durable Object replaces the container on the next request. The new container gets the new image and the new values. A build without the Docker layer cache, as in CI, gives a new image. So the first request after such a deploy starts a new container.

The container is a Node.js server, so these items work as on other container hosts:

- Subscriber notifications: webhooks, email and text messages.
- The notification queue. It runs in the container. A restart continues a job that stopped.
- A database connection pool in each container.
- The cache of each container keeps the last known data while the database is offline.

## Prerequisites

- A Cloudflare account on the Workers Paid plan. Containers need this plan.
- Docker, or a Docker-compatible engine, that runs on the computer that deploys. `wrangler deploy` builds the image for `linux/amd64` and pushes it to the Cloudflare registry.
- Node 24 and pnpm (`corepack enable`), with the dependencies installed: `pnpm install`.
- A Postgres database (Neon, Supabase, RDS, Cloud SQL, and so on) or a MongoDB database (for example Atlas). The database must accept connections from the internet, because the addresses of the containers are not fixed. Use TLS and a strong password.

## Steps

### 1. Log in and name the Worker

```bash
npx wrangler login
```

In `wrangler.jsonc`, set `name` and the `vars`. Set at least `SITE_URL`, the public URL of the status page.

### 2. Connect the database

```bash
npx wrangler secret put DATABASE_URI   # postgres://USER:PASSWORD@HOST:5432/incident_command
```

For MongoDB, use the `mongodb+srv://` connection string. See [TLS for Postgres](../../docs/deployment.md#tls-for-postgres) for the `sslmode` settings.

[Hyperdrive](https://developers.cloudflare.com/hyperdrive/) is not used. A container cannot use a Hyperdrive binding, so the app connects to the database directly and keeps a connection pool.

### 3. Set secrets

Each command prompts for the value. Set only the secrets that you use.

```bash
npx wrangler secret put SETUP_TOKEN      # required to create the first admin at /manage/setup
npx wrangler secret put ENCRYPTION_KEY   # encrypts provider credentials (openssl rand -base64 32)
npx wrangler secret put WEBHOOK_SECRET   # signs webhook payloads
# Email (see docs/deployment.md): EMAIL_FROM plus SendGrid or SES credentials
npx wrangler secret put SENDGRID_API_KEY
```

Non-secret settings (`SITE_URL`, `SITE_NAME`, `CACHE_TTL`, `EMAIL_FROM`, …) go in `vars` in `wrangler.jsonc`.

### 4. Deploy

Start Docker. Then build the image, push it and deploy the Worker:

```bash
NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=<key> pnpm cf:deploy
```

See [Keep the server action ids between deploys](#keep-the-server-action-ids-between-deploys) for the key.

The Worker is served at `https://incident-command.<your-subdomain>.workers.dev`. After the first deploy, wait some minutes before you send requests: Cloudflare must prepare the image first. To use your own domain, add it under **Workers & Pages → your Worker → Settings → Domains & Routes**, then update `SITE_URL`.

## Container settings

These vars configure the Worker. The container does not get them.

| Var                       | Default | Description                                                                                                                                                                                                                |
| ------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONTAINER_INSTANCES`     | `1`     | The number of containers. Each client address uses one of them. Use more than one only with Postgres or MongoDB.                                                                                                           |
| `CONTAINER_INSTANCE_TYPE` | `basic` | The size of each container: `lite` (1/16 vCPU, 256 MiB), `basic` (1/4 vCPU, 1 GiB), `standard-1`, `standard-2`, `standard-3` or `standard-4`. The server uses approximately 200 MiB after it sends the first notification. |
| `CONTAINER_SLEEP_AFTER`   | `30m`   | An idle container stops after approximately this time. Use `ms`, `s`, `m` or `h`. The maximum is `6h`. A longer time gives fewer slow first requests and costs more.                                                       |

Cloudflare bills a container while it runs. See [Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/).

## Local development

```bash
pnpm cf:dev
```

This command runs the Worker in workerd and the container in your local Docker engine. Put local secrets in `.dev.vars` (git-ignored), for example `SETUP_TOKEN=...`. Press `r` to build the image again after a change to the app. For quick changes to the app, `pnpm dev` is faster.

## Required environment variables

| Variable       | Where  | Notes                                                                                  |
| -------------- | ------ | -------------------------------------------------------------------------------------- |
| `SITE_URL`     | `vars` | Public URL, used in notification links.                                                |
| `DATABASE_URI` | secret | Without it, each container uses its own memory store and loses its data when it stops. |
| `SETUP_TOKEN`  | secret | Required to create the first admin at `/manage/setup`.                                 |

Full list: [docs/deployment.md](../../docs/deployment.md#environment-variables).

## First admin

Open `https://<host>/manage/setup` and create the admin. Set `SETUP_TOKEN` first. Without it, the first visitor of the page becomes admin.

## Verify

```bash
curl https://incident-command.<your-subdomain>.workers.dev/healthz
# {"status":"ok","store":{...}}   ("degraded" while the database is down; 503 if the app cannot start)
curl https://incident-command.<your-subdomain>.workers.dev/api/v1/status
```

When the container does not answer in 60 seconds, the Worker answers `503` with `retry-after: 10`. The Workers Logs show the reason. The logs of the container are in the Containers dashboard.

## Keep the server action ids between deploys

Next.js salts the id of each server action with `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`. Without that variable, `next build` makes a new key, and each deploy changes every id. A portal page that a browser loaded before the deploy then sends ids that the new container does not know. Next.js logs `Failed to find Server Action`, answers 409, and the portal shows "This page is out of date" until the user loads the page again.

Make one key and set it for each deploy:

```bash
openssl rand -base64 32
```

```bash
NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=<key> pnpm cf:deploy
```

Wrangler gives only the `build_vars` of `wrangler.jsonc` to `docker build`, and that file is not secret. `pnpm cf:deploy` sets `WRANGLER_DOCKER_BIN` to [`scripts/wrangler-docker.sh`](../../scripts/wrangler-docker.sh). That script adds the key from the environment as a build argument. The key is not in the command line, in a file of the repository or in the image history. But `next build` writes the key into the server action manifest, so the key is in the files of the image. This is the same on each container host.

Keep the key and the image secret. Next.js also encrypts the closure variables of server actions with the key.

## Development Worker (GitHub Actions)

The [`deploy-development`](../../.github/workflows/deploy-development.yml) workflow deploys the `incident-command-development` Worker and its container to <https://dev.incident-command.org>. It runs on each push to `main`. You can also start it manually from the Actions tab. The job uses the `development` GitHub environment. The settings are in the `env.development` block of [`wrangler.jsonc`](../../wrangler.jsonc).

The workflow does these steps:

1. It installs the dependencies through Socket Firewall.
2. It runs `pnpm cf:deploy --env development` with the `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` secret in the environment. Wrangler builds the image with the Docker engine of the runner, pushes it and deploys the Worker.

The `development` environment in `wrangler.jsonc` sets these items:

- The Worker name is `incident-command-development`.
- The Worker has the custom domain `dev.incident-command.org`. The `workers.dev` URL and preview URLs are off.
- Workers Logs keeps all `console` output and all invocation logs (`head_sampling_rate: 1`).
- `SITE_URL` is `https://dev.incident-command.org`.

An environment does not inherit `vars`, `containers` or `durable_objects`. The `env.development` block repeats them.

### One-time setup

1. Add the `incident-command.org` zone to the Cloudflare account that hosts the Worker. Wrangler creates the DNS record and the certificate for `dev.incident-command.org`. If a CNAME record for that hostname exists, delete it first.
2. Create a Cloudflare API token. Use the "Edit Cloudflare Workers" template, and limit it to the account and the `incident-command.org` zone. The token must have these permissions:
   - Account > Workers Scripts > Edit
   - Account > the Containers permission with edit access. Wrangler calls this scope `containers:write` ("Manage Workers Containers").
   - Zone > Workers Routes > Edit, for `incident-command.org`
3. In the GitHub repository, open **Settings > Environments** and create the `development` environment. You can add a deployment branch rule that allows only `main`.
4. Add these environment secrets to `development`:

   | Secret                               | Value                                                                                                                                |
   | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
   | `CLOUDFLARE_API_TOKEN`               | The API token from step 2.                                                                                                           |
   | `CLOUDFLARE_ACCOUNT_ID`              | The account ID of the Cloudflare account.                                                                                            |
   | `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | A key from `openssl rand -base64 32`. See [Keep the server action ids between deploys](#keep-the-server-action-ids-between-deploys). |

5. Set the Worker secrets (see the next section) before the first deploy.

### Worker secrets

The workflow does not set Worker secrets. Wrangler keeps them between deploys, so set each secret one time:

```bash
npx wrangler secret put DATABASE_URI --env development
```

```bash
npx wrangler secret put SETUP_TOKEN --env development
```

If the Worker does not exist yet, wrangler asks to create it. A new secret makes a new version of the Worker. The container gets the new value on the next request.

| Secret             | Needed | Notes                                                                                                                  |
| ------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URI`     | Yes    | Postgres or MongoDB connection string. Without it, the container uses a memory store and loses its data when it stops. |
| `SETUP_TOKEN`      | Yes    | Protects `/manage/setup`. Without it, the first visitor becomes admin.                                                 |
| `ENCRYPTION_KEY`   | No     | Encrypts the provider credentials that admins save in the portal.                                                      |
| `WEBHOOK_SECRET`   | No     | Signs webhook payloads.                                                                                                |
| `SENDGRID_API_KEY` | No     | Email through SendGrid, when the email channel has no providers in the portal.                                         |

### Move from the OpenNext Worker

Earlier versions ran the app in the Worker through OpenNext. To move a Worker that you deployed that way:

1. Remove a `hyperdrive` block from `wrangler.jsonc`. Set the `DATABASE_URI` secret to the direct connection string of the database.
2. Keep the other secrets. The container gets them.
3. Deploy with `pnpm cf:deploy`. The first deploy creates the `AppContainer` Durable Object and the container application.
4. Delete the `.open-next` directory, if you have one.

## Notes and scaling

- Each container has its own in-process cache. With more than one container, a client on a different address can see data that is up to `CACHE_TTL` (default `30s`) old. Each container also keeps a portal session in memory for `SESSION_CACHE_TTL` (default `30s`). See [Health checks, caching and scaling](../../docs/deployment.md#health-checks-caching-and-scaling).
- Never use the memory store with more than one container. The memory store loses its data when the container stops, so use it only for previews.
- Each container keeps its own database connection pool. Size `CONTAINER_INSTANCES` against the connection limit of the database.
- The container serves the static files (`/_next/static/*` and `public/`) too. No edge cache is in front of them, so a cold start also delays these files.
- The container can connect to any public host. Webhook subscribers must use URLs that the container can reach.
- `docker build` installs the dependencies in the image from the frozen lockfile, with the policies of `pnpm-workspace.yaml`.
