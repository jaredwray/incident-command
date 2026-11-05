# Deploy to Cloudflare Workers

Runs the Next.js app on Workers through [OpenNext](https://opennext.js.org/cloudflare). Config files: [`wrangler.jsonc`](../../wrangler.jsonc) and [`open-next.config.ts`](../../open-next.config.ts) at the repo root.

> **Verified locally in workerd** (`pnpm cf:preview`): the status page, portal, JSON API and MCP server all work. Two things differ from container hosts:
>
> - **Database connections are opened per operation.** Workers cannot share a socket between requests, so the app detects Workers and disables connection pooling automatically (override with `DATABASE_POOL`). Put [Hyperdrive](https://developers.cloudflare.com/hyperdrive/) in front of Postgres so those connections are cheap. MongoDB opens a TLS connection to the database for each operation, because Hyperdrive does not support MongoDB.
> - **Subscriber notifications are not sent.** airhorn renders templates with `ejs` (through `ecto`), which needs `new Function()`, and Workers forbid code generation from strings. airhorn is loaded lazily, so this only affects notifications: incidents are still created and the failure is logged. Use a container host if you need email or webhook notifications.

## What works on Workers

| Store                                                                    | Supported         | Notes                                                                          |
| ------------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------ |
| Postgres via [Hyperdrive](https://developers.cloudflare.com/hyperdrive/) | Yes (recommended) | Pools connections close to your database.                                      |
| Postgres, direct                                                         | Yes               | `DATABASE_URI` secret; the database must accept connections from the internet. |
| MongoDB (Atlas or self-hosted)                                           | Yes               | `DATABASE_URI` secret; one connection per operation, so each page is slower.   |
| Memory                                                                   | Previews only     | Each isolate has its own copy; data disappears when the isolate is recycled.   |

## Prerequisites

- A Cloudflare account on the Workers Paid plan: the built Worker is about 4.8 MiB gzipped, over the Free plan's 3 MiB limit (Paid allows 10 MiB).
- Node 24 and pnpm (`corepack enable`), dependencies installed: `pnpm install`.
- A Postgres database reachable from the internet (Neon, Supabase, RDS, Cloud SQL, and so on), or a MongoDB database such as Atlas.

## Steps

### 1. Log in and name the Worker

```bash
npx wrangler login
```

In `wrangler.jsonc`, set `name` and the `vars` (at least `SITE_URL`, the public URL of the status page).

### 2. Connect Postgres

**Option A: Hyperdrive (recommended)**

```bash
npx wrangler hyperdrive create incident-command \
  --connection-string="postgres://USER:PASSWORD@HOST:5432/incident_command"
```

Uncomment the `hyperdrive` block in `wrangler.jsonc` and paste the returned `id`.

The app reads its connection string from `DATABASE_URI`, but Hyperdrive exposes its connection string on the binding (`env.HYPERDRIVE.connectionString`), and OpenNext only copies string variables into `process.env`. Bridge the two with a small entry file at the repo root, `cloudflare-worker.js`:

```js
// Passes the Hyperdrive connection string to the app as DATABASE_URI.
import handler from "./.open-next/worker.js";

export default {
	fetch(request, env, ctx) {
		if (env.HYPERDRIVE) {
			process.env.DATABASE_URI = env.HYPERDRIVE.connectionString;
		}
		return handler.fetch(request, env, ctx);
	},
};
```

Then set `"main": "cloudflare-worker.js"` in `wrangler.jsonc`. Do not also set a `DATABASE_URI` secret.

**Option B: direct connection**

```bash
npx wrangler secret put DATABASE_URI   # postgres://USER:PASSWORD@HOST:5432/incident_command
```

See [TLS for Postgres](../../docs/deployment.md#tls-for-postgres) for `sslmode` settings.

**Option C: MongoDB**

```bash
npx wrangler secret put DATABASE_URI   # mongodb+srv://USER:PASSWORD@cluster.mongodb.net/incident_command
```

The Worker opens a new connection for each database operation and closes it after. Workers do not let a socket outlive the request that opened it, so the driver cannot keep a pool. Allow connections from the internet in the Atlas network access list.

### 3. Set secrets

Each command prompts for the value. Set only the ones you use.

```bash
npx wrangler secret put SETUP_TOKEN      # required to create the first admin at /manage/setup
npx wrangler secret put WEBHOOK_SECRET   # signs webhook payloads
# Email (see docs/deployment.md): EMAIL_FROM plus SendGrid or SES credentials
npx wrangler secret put SENDGRID_API_KEY
npx wrangler secret put TWILIO_ACCOUNT_SID
npx wrangler secret put TWILIO_AUTH_TOKEN
```

Non-secret settings (`SITE_URL`, `SITE_NAME`, `CACHE_TTL`, `EMAIL_FROM`, …) go in `vars` in `wrangler.jsonc`.

### 4. Deploy

```bash
pnpm cf:deploy
```

The Worker is served at `https://incident-command.<your-subdomain>.workers.dev`. To use your own domain, add it under **Workers & Pages → your Worker → Settings → Domains & Routes**, then update `SITE_URL`.

## Local preview

```bash
pnpm cf:preview
```

Runs the production build in workerd locally. Put local secrets in `.dev.vars` (git-ignored), for example `SETUP_TOKEN=...`. With Hyperdrive, `localConnectionString` in `wrangler.jsonc` is used instead of the remote database.

## Required environment variables

| Variable       | Where                        | Notes                                                  |
| -------------- | ---------------------------- | ------------------------------------------------------ |
| `SITE_URL`     | `vars`                       | Public URL, used in notification links.                |
| `DATABASE_URI` | secret, or Hyperdrive bridge | Without it the per-isolate memory store is used.       |
| `SETUP_TOKEN`  | secret                       | Required to create the first admin at `/manage/setup`. |

Full list: [docs/deployment.md](../../docs/deployment.md#environment-variables).

## First admin

Open `https://<host>/manage/setup` and create the admin. Set `SETUP_TOKEN` first. Without it, whoever reaches the page first becomes admin.

## Verify

```bash
curl https://incident-command.<your-subdomain>.workers.dev/healthz
# {"status":"ok","store":{...}}   ("degraded" while the database is down; 503 if the app cannot start)
curl https://incident-command.<your-subdomain>.workers.dev/api/v1/status
```

## Development Worker (GitHub Actions)

The [`deploy-development`](../../.github/workflows/deploy-development.yml) workflow deploys the `incident-command-development` Worker to <https://dev.incident-command.org>. It runs on each push to `main`. You can also start it manually from the Actions tab. The job uses the `development` GitHub environment. The Worker settings are in the `env.development` block of [`wrangler.jsonc`](../../wrangler.jsonc).

The workflow does these steps:

1. It installs the dependencies through Socket Firewall.
2. It runs `opennextjs-cloudflare build --env development`.
3. It runs `wrangler deploy --env development`. Wrangler finds the OpenNext project and runs `opennextjs-cloudflare deploy`, which then runs `wrangler deploy`.

The `development` environment in `wrangler.jsonc` sets these items:

- The Worker name is `incident-command-development`.
- The Worker has the custom domain `dev.incident-command.org`. The `workers.dev` URL and preview URLs are off.
- Workers Logs keeps all `console` output and all invocation logs (`head_sampling_rate: 1`).
- `SITE_URL` is `https://dev.incident-command.org`.

An environment does not inherit `vars` or bindings such as `hyperdrive`. To use Hyperdrive for this Worker, add a `hyperdrive` block inside `env.development`.

### One-time setup

1. Add the `incident-command.org` zone to the Cloudflare account that hosts the Worker. Wrangler creates the DNS record and the certificate for `dev.incident-command.org`. If a CNAME record for that hostname exists, delete it first.
2. Create a Cloudflare API token. Use the "Edit Cloudflare Workers" template, and limit it to the account and the `incident-command.org` zone. The token must have these permissions:
   - Account > Workers Scripts > Edit
   - Zone > Workers Routes > Edit, for `incident-command.org`
3. In the GitHub repository, open **Settings > Environments** and create the `development` environment. You can add a deployment branch rule that allows only `main`.
4. Add these environment secrets to `development`:

   | Secret                  | Value                                     |
   | ----------------------- | ----------------------------------------- |
   | `CLOUDFLARE_API_TOKEN`  | The API token from step 2.                |
   | `CLOUDFLARE_ACCOUNT_ID` | The account ID of the Cloudflare account. |

5. Set the Worker secrets (see the next section) before the first deploy.

### Worker secrets

The workflow does not set Worker secrets. Wrangler keeps them between deploys, so set each secret one time:

```bash
npx wrangler secret put DATABASE_URI --env development
```

```bash
npx wrangler secret put SETUP_TOKEN --env development
```

If the Worker does not exist yet, wrangler asks to create it.

| Secret           | Needed | Notes                                                                                                                                                   |
| ---------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URI`   | Yes    | Postgres or MongoDB connection string. Without it, each isolate uses its own memory store and loses its data. Do not set it with the Hyperdrive bridge. |
| `SETUP_TOKEN`    | Yes    | Protects `/manage/setup`. Without it, the first visitor becomes admin.                                                                                  |
| `WEBHOOK_SECRET` | No     | Signs webhook payloads. Workers do not send notifications now, so this secret has no effect.                                                            |

Do not set the email secrets. Workers do not send subscriber notifications.

## Notes and scaling

- Workers run many isolates across Cloudflare's network. Each isolate has its own in-process cache, so reads can be up to `CACHE_TTL` (default `30s`) stale between isolates. Sessions and API tokens are not cached, so sign-outs and token revocations apply immediately.
- Isolates are short-lived, so serving last known data during a database outage only lasts as long as an isolate does.
- `global_fetch_strictly_public` blocks requests to private and internal addresses, so webhook subscribers must use public URLs.
- Webhooks use `fetch`. The email providers (SendGrid via airhorn's Twilio provider, SES via the AWS SDK) have not been verified on Workers; test them in a preview first.
