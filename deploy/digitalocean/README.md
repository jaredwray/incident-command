# Deploy to DigitalOcean App Platform

Builds the repo's `Dockerfile` on App Platform and attaches a managed Postgres database. Spec: [`app.yaml`](app.yaml).

## Prerequisites

- A DigitalOcean account and [`doctl`](https://docs.digitalocean.com/reference/doctl/how-to/install/), authenticated: `doctl auth init`.
- To deploy from your own fork, connect GitHub to App Platform (Apps → Create App → GitHub) and change `github.repo` in `app.yaml`.

## Steps

1. Edit [`app.yaml`](app.yaml): `region`, `github.repo`/`branch` if you use a fork, and `SETUP_TOKEN`.
2. Create the app:

   ```bash
   doctl apps create --spec deploy/digitalocean/app.yaml
   doctl apps list                      # note the app ID and URL
   ```

3. Apply later spec changes:

   ```bash
   doctl apps update <APP_ID> --spec deploy/digitalocean/app.yaml
   ```

`deploy_on_push: true` redeploys on every push to `main`. Secrets marked `type: SECRET` are encrypted on first submission; you can also edit them under **App → Settings → web → Environment Variables**.

## Required environment variables

| Variable       | Value in `app.yaml`                                                    |
| -------------- | ---------------------------------------------------------------------- |
| `DATABASE_URI` | `${db.DATABASE_URL}&uselibpqcompat=true` (bound to the `db` component) |
| `SITE_URL`     | `${APP_URL}`; set it to your custom domain once you add one            |
| `SETUP_TOKEN`  | First admin at `/manage/setup`                                         |

The `uselibpqcompat=true` suffix is needed because node-postgres treats `sslmode=require` as full certificate verification, and DigitalOcean databases use DigitalOcean's own CA. With it, the connection stays encrypted but the certificate chain is not verified. If the app logs a certificate or connection error at boot, set `DATABASE_URI` by hand to the database's connection string (Databases → your database → Connection details) with `sslmode=no-verify` in place of `sslmode=require`.

Email, webhooks and the rest: [docs/deployment.md](../../docs/deployment.md#environment-variables).

## First admin

Open `https://<app-url>/manage/setup` and create the admin. Set `SETUP_TOKEN` first. Without it, whoever reaches the page first becomes admin.

## Verify

```bash
curl https://<app-url>/healthz
# {"status":"ok","store":{...}}   ("degraded" while the database is down; 503 if the app cannot start)
curl https://<app-url>/api/v1/status
```

## Scaling

- Raise `instance_count` (or enable autoscaling on a dedicated instance size). Each instance has its own in-process cache, so with several instances public reads can be up to `CACHE_TTL` (default `30s`) stale. Sessions and API tokens are not cached.
- The health check reports `degraded` with a 200 when the database goes down after boot, so App Platform keeps the instance (and the cached data it serves) running. It returns 503 only when the app cannot start, for example when the database is unreachable at boot.
- The dev database is for getting started. For production, use a managed Postgres cluster (see the comment in `app.yaml`) with daily backups.
