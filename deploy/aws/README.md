# Deploy to AWS

Push the container image to Amazon ECR, then run it on **App Runner** (simplest) or **ECS Fargate** (more control), with RDS for PostgreSQL and SES for email.

Files here: [`iam-policy.json`](iam-policy.json) (SES + Secrets Manager permissions) and [`ecs-task-definition.json`](ecs-task-definition.json).

## Prerequisites

- AWS CLI v2 configured (`aws configure` or SSO) and Docker.
- A VPC with at least two private subnets. If the app runs inside the VPC, those subnets need a NAT gateway for outbound internet (webhooks, SendGrid, SES).

```bash
export AWS_REGION=us-east-1
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export REPO=$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/incident-command
```

## 1. Push the image to ECR

```bash
aws ecr create-repository --repository-name incident-command
aws ecr get-login-password | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com
docker build --platform linux/amd64 -t $REPO:latest .
docker push $REPO:latest
```

## 2. Database: RDS for PostgreSQL (recommended)

```bash
aws rds create-db-instance \
  --db-instance-identifier incident-command-db \
  --engine postgres \
  --db-instance-class db.t4g.micro \
  --allocated-storage 20 \
  --db-name incident_command \
  --master-username incident \
  --master-user-password 'CHOOSE_A_DB_PASSWORD' \
  --db-subnet-group-name YOUR_DB_SUBNET_GROUP \
  --vpc-security-group-ids sg-DATABASE \
  --no-publicly-accessible
aws rds wait db-instance-available --db-instance-identifier incident-command-db
DB_HOST=$(aws rds describe-db-instances --db-instance-identifier incident-command-db \
  --query 'DBInstances[0].Endpoint.Address' --output text)
export DATABASE_URI="postgresql://incident:CHOOSE_A_DB_PASSWORD@$DB_HOST:5432/incident_command?uselibpqcompat=true&sslmode=require"
```

RDS requires TLS, and its CA is not in Node's trust store; `uselibpqcompat=true&sslmode=require` encrypts without verifying the chain (see [TLS for Postgres](../../docs/deployment.md#tls-for-postgres)). The database security group must allow port 5432 from the app's security group. Tables are created on first boot.

**DocumentDB:** it is MongoDB-compatible but not identical, so test it before relying on it. It needs `retryWrites=false` and TLS with Amazon's CA bundle, which the image does not include (extend the image with the bundle and add `tlsCAFile=` to the URL). RDS Postgres is the simpler choice.

## 3. Secrets

```bash
DB_SECRET_ARN=$(aws secretsmanager create-secret --name incident-command/database-url \
  --secret-string "$DATABASE_URI" --query ARN --output text)
SETUP_SECRET_ARN=$(aws secretsmanager create-secret --name incident-command/setup-token \
  --secret-string 'CHOOSE_A_LONG_TOKEN' --query ARN --output text)
```

Add `incident-command/webhook-secret` and other optional secrets the same way.

## 4. Email with SES

```bash
aws sesv2 create-email-identity --email-identity example.com   # then add the DKIM CNAMEs it returns to DNS
```

- Set `EMAIL_FROM` (an address on the verified domain) and `AWS_SES_REGION`. `AWS_SES_REGION` also selects SES automatically; with only `AWS_REGION` set you also need `EMAIL_PROVIDER=ses`.
- Leave `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` unset: the SDK uses the service's IAM role. The role needs `ses:SendEmail` ([`iam-policy.json`](iam-policy.json)).
- New SES accounts are in the sandbox and can only send to verified addresses. Request production access in the SES console.

## 5a. Run on App Runner

```bash
# Role App Runner uses to pull from ECR
aws iam create-role --role-name incident-command-apprunner-ecr --assume-role-policy-document \
  '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"build.apprunner.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam attach-role-policy --role-name incident-command-apprunner-ecr \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess

# Role the running app uses (SES + secrets)
aws iam create-role --role-name incident-command-apprunner-instance --assume-role-policy-document \
  '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"tasks.apprunner.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam put-role-policy --role-name incident-command-apprunner-instance \
  --policy-name incident-command --policy-document file://deploy/aws/iam-policy.json

# VPC connector so the service can reach RDS in private subnets
VPC_CONNECTOR_ARN=$(aws apprunner create-vpc-connector --vpc-connector-name incident-command \
  --subnets subnet-AAA subnet-BBB --security-groups sg-APP \
  --query VpcConnector.VpcConnectorArn --output text)

cat > /tmp/apprunner-service.json <<EOF
{
  "ServiceName": "incident-command",
  "SourceConfiguration": {
    "ImageRepository": {
      "ImageIdentifier": "$REPO:latest",
      "ImageRepositoryType": "ECR",
      "ImageConfiguration": {
        "Port": "3000",
        "RuntimeEnvironmentVariables": {
          "SITE_URL": "https://status.example.com",
          "EMAIL_FROM": "status@example.com",
          "AWS_SES_REGION": "$AWS_REGION"
        },
        "RuntimeEnvironmentSecrets": {
          "DATABASE_URI": "$DB_SECRET_ARN",
          "SETUP_TOKEN": "$SETUP_SECRET_ARN"
        }
      }
    },
    "AuthenticationConfiguration": {
      "AccessRoleArn": "arn:aws:iam::$ACCOUNT_ID:role/incident-command-apprunner-ecr"
    },
    "AutoDeploymentsEnabled": true
  },
  "InstanceConfiguration": {
    "Cpu": "1 vCPU",
    "Memory": "2 GB",
    "InstanceRoleArn": "arn:aws:iam::$ACCOUNT_ID:role/incident-command-apprunner-instance"
  },
  "HealthCheckConfiguration": {
    "Protocol": "HTTP", "Path": "/api/health",
    "Interval": 10, "Timeout": 5, "HealthyThreshold": 1, "UnhealthyThreshold": 10
  },
  "NetworkConfiguration": {
    "EgressConfiguration": { "EgressType": "VPC", "VpcConnectorArn": "$VPC_CONNECTOR_ARN" }
  }
}
EOF
aws apprunner create-service --cli-input-json file:///tmp/apprunner-service.json
```

`AutoDeploymentsEnabled` redeploys whenever you push a new `:latest` image. Once the service is running, set `SITE_URL` to its `ServiceUrl` (or your custom domain) with `aws apprunner update-service` or in the console.

## 5b. Run on ECS Fargate

```bash
aws ecs create-cluster --cluster-name incident-command
aws logs create-log-group --log-group-name /ecs/incident-command

TRUST='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
# Execution role: pull the image, write logs, read secrets
aws iam create-role --role-name incident-command-ecs-execution --assume-role-policy-document "$TRUST"
aws iam attach-role-policy --role-name incident-command-ecs-execution \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
aws iam put-role-policy --role-name incident-command-ecs-execution \
  --policy-name incident-command --policy-document file://deploy/aws/iam-policy.json
# Task role: what the app itself can do (SES)
aws iam create-role --role-name incident-command-ecs-task --assume-role-policy-document "$TRUST"
aws iam put-role-policy --role-name incident-command-ecs-task \
  --policy-name incident-command --policy-document file://deploy/aws/iam-policy.json
```

Edit [`ecs-task-definition.json`](ecs-task-definition.json): replace `ACCOUNT_ID`, `REGION`, the secret ARNs (`$DB_SECRET_ARN`, `$SETUP_SECRET_ARN`) and the environment values. Then:

```bash
aws ecs register-task-definition --cli-input-json file://deploy/aws/ecs-task-definition.json

TG_ARN=$(aws elbv2 create-target-group --name incident-command --protocol HTTP --port 3000 \
  --target-type ip --vpc-id vpc-XXX --health-check-path /api/health \
  --query 'TargetGroups[0].TargetGroupArn' --output text)
# Create (or reuse) an internet-facing ALB with an HTTPS listener forwarding to $TG_ARN.

aws ecs create-service --cluster incident-command --service-name incident-command \
  --task-definition incident-command --desired-count 1 --launch-type FARGATE \
  --network-configuration 'awsvpcConfiguration={subnets=[subnet-AAA,subnet-BBB],securityGroups=[sg-APP],assignPublicIp=DISABLED}' \
  --load-balancers targetGroupArn=$TG_ARN,containerName=app,containerPort=3000
```

To roll out a new image: push it, then `aws ecs update-service --cluster incident-command --service incident-command --force-new-deployment`.

## Required environment variables

| Variable                       | How                            |
| ------------------------------ | ------------------------------ |
| `DATABASE_URI`                 | Secrets Manager                |
| `SITE_URL`                     | Plain variable: the public URL |
| `SETUP_TOKEN`                  | First admin at `/manage/setup` |
| `EMAIL_FROM`, `AWS_SES_REGION` | Optional, for SES email        |

Full list: [docs/deployment.md](../../docs/deployment.md#environment-variables).

## First admin

Open `https://<host>/manage/setup` and create the admin. Set `SETUP_TOKEN` first. Without it, whoever reaches the page first becomes admin.

## Verify

```bash
curl https://<host>/api/health
# {"status":"ok","store":{...}}   ("degraded" while the database is down; 503 if the app cannot start)
curl https://<host>/api/v1/status
```

## Scaling

- App Runner scales on concurrent requests (default auto scaling configuration); ECS scales with `--desired-count` or Service Auto Scaling.
- Each instance has its own in-process cache, so with several instances public reads can be up to `CACHE_TTL` (default `30s`) stale. Sessions and API tokens are not cached.
- Each instance keeps its own Postgres connection pool; size the RDS instance's connection limit accordingly.
- `/api/health` stays at 200 (`"status":"degraded"`) when the database goes down after boot, so App Runner and ECS keep instances that are still serving cached data. It returns 503 only when the app cannot start, for example when the database is unreachable at boot.
