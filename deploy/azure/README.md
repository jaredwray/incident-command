# Deploy to Azure Container Apps

Builds the repo's `Dockerfile` in Azure Container Registry and runs it on Azure Container Apps, with Azure Database for PostgreSQL Flexible Server (or Cosmos DB for MongoDB).

## Prerequisites

- An Azure subscription and the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli), logged in (`az login`).
- Run the commands from the repo root.

```bash
az extension add --name containerapp --upgrade
az provider register --namespace Microsoft.App
az provider register --namespace Microsoft.OperationalInsights

export RG=incident-command
export LOCATION=eastus
az group create --name $RG --location $LOCATION
```

## 1. Database

### Option A: Azure Database for PostgreSQL Flexible Server (recommended)

```bash
az postgres flexible-server create \
  --resource-group $RG --name incident-command-db --location $LOCATION \
  --tier Burstable --sku-name Standard_B1ms --storage-size 32 --version 17 \
  --admin-user incident --admin-password 'CHOOSE_A_DB_PASSWORD' \
  --public-access 0.0.0.0
az postgres flexible-server db create --resource-group $RG \
  --server-name incident-command-db --database-name incident_command

export DATABASE_URL="postgresql://incident:CHOOSE_A_DB_PASSWORD@incident-command-db.postgres.database.azure.com:5432/incident_command?sslmode=verify-full"
```

`--public-access 0.0.0.0` allows connections from Azure services; use VNet integration for private networking. Azure's server certificates chain to public roots, so `sslmode=verify-full` works. Tables are created on first boot.

### Option B: Azure Cosmos DB for MongoDB

Create an **Azure Cosmos DB for MongoDB (vCore)** cluster in the portal, allow access from Azure services, and copy its connection string. It is MongoDB-compatible but not identical, so test it before relying on it. The connection string usually names no database, so also set `DATABASE_NAME`:

```bash
export DATABASE_URL='mongodb+srv://USER:PASSWORD@CLUSTER.mongocluster.cosmos.azure.com/?tls=true&authMechanism=SCRAM-SHA-256&retrywrites=false&maxIdleTimeMS=120000'
# and add DATABASE_NAME=incident_command to --set-env-vars below
```

## 2. Build and deploy

```bash
az containerapp up \
  --name incident-command \
  --resource-group $RG \
  --location $LOCATION \
  --source . \
  --ingress external \
  --target-port 3000
```

This creates a registry, builds the image, and creates the Container Apps environment and app.

## 3. Secrets and settings

```bash
FQDN=$(az containerapp show --name incident-command --resource-group $RG \
  --query properties.configuration.ingress.fqdn -o tsv)

az containerapp secret set --name incident-command --resource-group $RG \
  --secrets database-url="$DATABASE_URL" setup-token='CHOOSE_A_LONG_TOKEN'

az containerapp update --name incident-command --resource-group $RG \
  --set-env-vars DATABASE_URL=secretref:database-url SETUP_TOKEN=secretref:setup-token \
    SITE_URL=https://$FQDN HOSTNAME=0.0.0.0 \
  --min-replicas 1 --max-replicas 3
```

Add `WEBHOOK_SECRET`, `SETUP_TOKEN` and email keys the same way (`secret set`, then `secretref:`). To keep secrets in Key Vault instead, give the app a managed identity with the **Key Vault Secrets User** role and reference them with `--secrets "database-url=keyvaultref:https://VAULT.vault.azure.net/secrets/database-url,identityref:system"`.

Redeploy after code changes with the same `az containerapp up` command.

## Required environment variables

| Variable       | How                                   |
| -------------- | ------------------------------------- |
| `DATABASE_URL` | Secret (`secretref:`)                 |
| `SITE_URL`     | `https://$FQDN` or your custom domain |
| `SETUP_TOKEN`  | First admin at `/manage/setup`        |

Email: SendGrid (`SENDGRID_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`) or SES with access keys (`AWS_SES_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`), plus `EMAIL_FROM`. Full list: [docs/deployment.md](../../docs/deployment.md#environment-variables).

## First admin

Open `https://$FQDN/manage/setup` and create the admin. Set `SETUP_TOKEN` first. Without it, whoever reaches the page first becomes admin.

## Verify

```bash
curl https://$FQDN/api/health
# {"status":"ok","store":{...}}   ("degraded" while the database is down; 503 if the app cannot start)
curl https://$FQDN/api/v1/status
az containerapp logs show --name incident-command --resource-group $RG --follow
```

## Scaling

- Container Apps scales to zero by default. `--min-replicas 1` avoids cold starts and keeps a warm in-process cache, which also keeps serving the last known data if the database goes offline.
- Each replica has its own cache, so with several replicas public reads can be up to `CACHE_TTL` (default `30s`) stale. Sessions and API tokens are not cached.
- Each replica keeps its own Postgres connection pool; size `--max-replicas` against the server's connection limit.
- Default probes are TCP. An HTTP probe on `/api/health` is safe to add: it reports `degraded` with a 200 during a database outage, and 503 only when the app cannot start.
