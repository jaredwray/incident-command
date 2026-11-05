# Deploy to Google Cloud Run

Builds the repo's `Dockerfile` with Cloud Build and runs it on Cloud Run, with Cloud SQL for PostgreSQL (or MongoDB Atlas) and secrets in Secret Manager.

## Prerequisites

- A Google Cloud project with billing enabled, and the [`gcloud` CLI](https://cloud.google.com/sdk/docs/install) logged in (`gcloud auth login`).
- Run the commands from the repo root.

```bash
export PROJECT_ID=$(gcloud config get-value project)
export REGION=us-central1
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com
```

## 1. Database

### Option A: Cloud SQL for PostgreSQL (recommended)

```bash
gcloud sql instances create incident-command-db \
  --database-version=POSTGRES_17 --edition=enterprise --tier=db-f1-micro --region=$REGION
gcloud sql databases create incident_command --instance=incident-command-db
gcloud sql users create incident --instance=incident-command-db --password='CHOOSE_A_DB_PASSWORD'

export INSTANCE=$PROJECT_ID:$REGION:incident-command-db
export DATABASE_URI="postgresql://incident:CHOOSE_A_DB_PASSWORD@/incident_command?host=/cloudsql/$INSTANCE"
```

Cloud Run connects through the Cloud SQL Unix socket (`--add-cloudsql-instances` below), so no TLS settings or IP allow-lists are needed. Tables are created on first boot.

### Option B: MongoDB Atlas

```bash
export DATABASE_URI='mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/incident_command?retryWrites=true&w=majority'
```

Cloud Run has no fixed outbound IP. Either allow `0.0.0.0/0` in the Atlas IP access list (with a strong password), or send egress through a VPC with Cloud NAT and a static IP. Leave out `--add-cloudsql-instances` when deploying.

## 2. Secrets and service account

```bash
printf '%s' "$DATABASE_URI" | gcloud secrets create incident-command-database-url --data-file=-
printf '%s' 'CHOOSE_A_LONG_TOKEN' | gcloud secrets create incident-command-setup-token --data-file=-

gcloud iam service-accounts create incident-command
export SA=incident-command@$PROJECT_ID.iam.gserviceaccount.com
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member=serviceAccount:$SA --role=roles/cloudsql.client
for s in incident-command-database-url incident-command-setup-token; do
  gcloud secrets add-iam-policy-binding $s \
    --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor
done
```

Store other secrets (`WEBHOOK_SECRET`, `SETUP_TOKEN`, `SENDGRID_API_KEY`, `TWILIO_AUTH_TOKEN`, …) the same way and add them to `--set-secrets`.

## 3. Deploy

```bash
gcloud run deploy incident-command \
  --source . \
  --region=$REGION \
  --allow-unauthenticated \
  --port=3000 \
  --service-account=$SA \
  --add-cloudsql-instances=$INSTANCE \
  --set-secrets=DATABASE_URI=incident-command-database-url:latest,SETUP_TOKEN=incident-command-setup-token:latest \
  --min-instances=1 \
  --max-instances=2
```

Then point `SITE_URL` at the service URL (or your custom domain):

```bash
URL=$(gcloud run services describe incident-command --region=$REGION --format='value(status.url)')
gcloud run services update incident-command --region=$REGION --update-env-vars=SITE_URL=$URL
```

### Redeploys with Cloud Build (optional)

[`cloudbuild.yaml`](cloudbuild.yaml) builds, pushes to Artifact Registry and rolls the new image out to the existing service:

```bash
gcloud artifacts repositories create incident-command --repository-format=docker --location=$REGION
gcloud builds submit --config deploy/gcp/cloudbuild.yaml \
  --substitutions=_REGION=$REGION,_REPOSITORY=incident-command,_SERVICE=incident-command .
```

The Cloud Build service account needs `roles/run.admin` and `roles/iam.serviceAccountUser` on `$SA`. Attach it to a Cloud Build trigger to deploy on every push.

## Required environment variables

| Variable       | How                                         |
| -------------- | ------------------------------------------- |
| `DATABASE_URI` | Secret Manager (`--set-secrets`)            |
| `SITE_URL`     | `--update-env-vars`, after the first deploy |
| `SETUP_TOKEN`  | First admin at `/manage/setup`              |

Cloud Run sets `PORT` itself (`--port=3000`). Email via SES: set `EMAIL_FROM`, `AWS_SES_REGION` and secrets for `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`. Full list: [docs/deployment.md](../../docs/deployment.md#environment-variables).

## First admin

Open `$URL/manage/setup` and create the admin. Set `SETUP_TOKEN` first. Without it, whoever reaches the page first becomes admin.

## Verify

```bash
curl $URL/api/health
# {"status":"ok","store":{...}}   ("degraded" while the database is down; 503 if the app cannot start)
curl $URL/api/v1/status
gcloud run services logs read incident-command --region=$REGION --limit=50
```

## Scaling

- `--min-instances=1` avoids cold starts and keeps one warm in-process cache, which also keeps serving the last known data if the database goes offline. With `0`, an idle service scales to zero and the first request pays the startup cost.
- Each instance has its own cache, so with several instances public reads can be up to `CACHE_TTL` (default `30s`) stale. Sessions and API tokens are not cached.
- Each instance keeps its own Postgres connection pool (node-postgres defaults to 10 connections). Keep `--max-instances` × pool size under the database's limit (`db-f1-micro` allows 25), or pick a larger tier.
- Cloud Run ignores the image's `HEALTHCHECK`. An HTTP liveness probe on `/api/health` is safe to add: it reports `degraded` with a 200 during a database outage, and 503 only when the app cannot start.
