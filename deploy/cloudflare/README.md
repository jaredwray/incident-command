# Deploy to Cloudflare Workers

Runs the Next.js app on Workers through [OpenNext](https://opennext.js.org/cloudflare). Config files: [`wrangler.jsonc`](../../wrangler.jsonc) and [`open-next.config.ts`](../../open-next.config.ts) at the repo root.

> **Verified locally in workerd** (`pnpm cf:preview`): the status page, portal, JSON API and MCP server all work. Two things differ from container hosts:
>
> - **Database connections are opened per query.** Workers cannot share a socket between requests, so the app detects Workers and disables the `pg` pool automatically (override with `DATABASE_POOL`). Put [Hyperdrive](https://developers.cloudflare.com/hyperdrive/) in front of Postgres so those connections are cheap.
> - **Subscriber notifications are not sent.** airhorn renders templates with `ejs` (through `ecto`), which needs `new Function()`, and Workers forbid code generation from strings. airhorn is loaded lazily, so this only affects notifications: incidents are still created and the failure is logged. Use a container host if you need email or webhook notifications.

## What works on Workers

| Store                                                                    | Supported         | Notes                                                                          |
| ------------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------ |
| Postgres via [Hyperdrive](https://developers.cloudflare.com/hyperdrive/) | Yes (recommended) | Pools connections close to your database.                                      |
| Postgres, direct                                                         | Yes               | `DATABASE_URL` secret; the database must accept connections from the internet. |
| MongoDB                                                                  | **No**            | The MongoDB driver does not run on Workers. Use a container host instead.      |
| Memory                                                                   | Previews only     | Each isolate has its own copy; data disappears when the isolate is recycled.   |

## Prerequisites

- A Cloudflare account on the Workers Paid plan: the built Worker is about 4.8 MiB gzipped, over the Free plan's 3 MiB limit (Paid allows 10 MiB).
- Node 24 and pnpm (`corepack enable`), dependencies installed: `pnpm install`.
- A Postgres database reachable from the internet (Neon, Supabase, RDS, Cloud SQL, and so on).

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

The app reads its connection string from `DATABASE_URL`, but Hyperdrive exposes its connection string on the binding (`env.HYPERDRIVE.connectionString`), and OpenNext only copies string variables into `process.env`. Bridge the two with a small entry file at the repo root, `cloudflare-worker.js`:

```js
// Passes the Hyperdrive connection string to the app as DATABASE_URL.
import handler from "./.open-next/worker.js";

export default {
	fetch(request, env, ctx) {
		if (env.HYPERDRIVE) {
			process.env.DATABASE_URL = env.HYPERDRIVE.connectionString;
		}
		return handler.fetch(request, env, ctx);
	},
};
```

Then set `"main": "cloudflare-worker.js"` in `wrangler.jsonc`. Do not also set a `DATABASE_URL` secret.

**Option B: direct connection**

```bash
npx wrangler secret put DATABASE_URL   # postgres://USER:PASSWORD@HOST:5432/incident_command
```

See [TLS for Postgres](../../docs/deployment.md#tls-for-postgres) for `sslmode` settings.

### 3. Set secrets

Each command prompts for the value. Set only the ones you use.

```bash
npx wrangler secret put ADMIN_EMAIL      # first admin, created on first boot
npx wrangler secret put ADMIN_PASSWORD   # at least 8 characters
npx wrangler secret put SETUP_TOKEN      # protects /manage/setup if you skip ADMIN_*
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

Runs the production build in workerd locally. Put local secrets in `.dev.vars` (git-ignored), for example `ADMIN_EMAIL=...`. With Hyperdrive, `localConnectionString` in `wrangler.jsonc` is used instead of the remote database.

## Required environment variables

| Variable                                           | Where                        | Notes                                            |
| -------------------------------------------------- | ---------------------------- | ------------------------------------------------ |
| `SITE_URL`                                         | `vars`                       | Public URL, used in notification links.          |
| `DATABASE_URL`                                     | secret, or Hyperdrive bridge | Without it the per-isolate memory store is used. |
| `ADMIN_EMAIL` + `ADMIN_PASSWORD`, or `SETUP_TOKEN` | secrets                      | First admin.                                     |

Full list: [docs/deployment.md](../../docs/deployment.md#environment-variables).

## First admin

- Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` before the first deploy. The admin is created on first boot while no members exist; changing the variables later has no effect (change the password in the portal).
- Or open `https://<host>/manage/setup`. Set `SETUP_TOKEN` first, otherwise whoever reaches the page first becomes admin.

## Verify

```bash
curl https://incident-command.<your-subdomain>.workers.dev/api/health
# {"status":"ok","store":{...}}   ("degraded" while the database is down; 503 if the app cannot start)
curl https://incident-command.<your-subdomain>.workers.dev/api/v1/status
```

## Notes and scaling

- Workers run many isolates across Cloudflare's network. Each isolate has its own in-process cache, so reads can be up to `CACHE_TTL` (default `30s`) stale between isolates. Sessions and API tokens are not cached, so sign-outs and token revocations apply immediately.
- Isolates are short-lived, so serving last known data during a database outage only lasts as long as an isolate does.
- `global_fetch_strictly_public` blocks requests to private and internal addresses, so webhook subscribers must use public URLs.
- Webhooks use `fetch`. The email providers (SendGrid via airhorn's Twilio provider, SES via the AWS SDK) have not been verified on Workers; test them in a preview first.
