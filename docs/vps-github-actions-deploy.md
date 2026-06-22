# GitHub Actions VPS Deployment

This workflow deploys the CRM to one VPS with Docker Compose. It builds the application image in GitHub Actions, pushes it to GHCR, then connects to the VPS over SSH and runs the stack from `/opt/ai-agent-crm`.

## VPS Prerequisites

- Docker Engine with the Compose plugin installed.
- An SSH user that can write to `/opt/ai-agent-crm`, or can run passwordless `sudo`.
- Inbound firewall access to the chosen app port, for example `3000`.
- A separate Postgres service reachable from CRM containers. For your current VPS layout, the existing Postgres container is published as `5433:5432` on the host, so CRM connects to `host.docker.internal:5433`.
- Enough disk space under `/opt/ai-agent-crm` for Redis data and backups.

## Required GitHub Secrets

- `VPS_HOST`: VPS IP or hostname.
- `VPS_USER`: SSH user.
- `VPS_SSH_KEY`: private key for that user.
- `POSTGRES_PASSWORD`: stable, URL-safe database password. Do not rotate it casually after data exists.
- `EMAIL_CONFIG_SECRET`: stable mailbox credential encryption secret.
- `EMAIL_OAUTH_STATE_SECRET`: stable OAuth state signing secret.

Optional secrets:

- `VPS_PORT`: SSH port, defaults to `22`.
- `APP_BASE_URL`: external CRM origin, for example `https://crm.example.com`. If omitted, the workflow uses `http://VPS_HOST:APP_PORT` and enables insecure HTTP explicitly.
- `GHCR_USERNAME` and `GHCR_TOKEN`: use a token with `read:packages` when the GHCR package is private and the default workflow token cannot pull it from the VPS.
- `AI_API_KEY`, `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, `OUTLOOK_OAUTH_CLIENT_ID`, `OUTLOOK_OAUTH_CLIENT_SECRET`.

Optional repository variables:

- `VPS_APP_PORT`: host port exposed by Compose; workflow dispatch input `app_port` overrides it.
- `ALLOW_INSECURE_APP_BASE_URL`: defaults to `true` only for direct `http://ip:port` deployments. Set it to `false` when using HTTPS.
- `POSTGRES_HOST`, default `host.docker.internal`.
- `POSTGRES_PORT`, default `5433`.
- `POSTGRES_DB`, `POSTGRES_USER`, `EMAIL_DELIVERY_MODE`, `EMAIL_SYNC_INTERVAL_MS`, `EMAIL_SYNC_LIMIT`, `EMAIL_SYNC_USER_ID`, `AI_PROVIDER`, `AI_BASE_URL`, `AI_MODEL`, `AI_TIMEOUT_MS`, `GMAIL_OAUTH_SCOPE`, `OUTLOOK_OAUTH_SCOPE`.
- `VPS_SUDO`: defaults to `sudo`. Set it to an empty value when the SSH user is root and the image does not include sudo.

## Ports And Database Identity

- Web host port: `APP_PORT`, supplied by manual workflow input `app_port`, repository variable `VPS_APP_PORT`, or default `3000`.
- SSH port: GitHub secret `VPS_PORT`, default `22`.
- Postgres host from CRM containers: repository variable `POSTGRES_HOST`, default `host.docker.internal`.
- Postgres port from CRM containers: repository variable `POSTGRES_PORT`, default `5433`.
- Postgres user: repository variable `POSTGRES_USER`, default `crm`.
- Postgres database: repository variable `POSTGRES_DB`, default `ai_agent_crm`.
- Postgres password: GitHub secret `POSTGRES_PASSWORD`.
- Generated database URL: `postgresql://POSTGRES_USER:POSTGRES_PASSWORD@POSTGRES_HOST:POSTGRES_PORT/POSTGRES_DB?schema=public`.

For a Postgres container that maps `5433:5432` on the VPS host, keep `POSTGRES_HOST=host.docker.internal` and `POSTGRES_PORT=5433`. The VPS compose file adds `host.docker.internal:host-gateway` so Linux containers can reach the host-mapped port.

Redis is still managed by this CRM Compose stack and is private to the Compose network. Only the web app is exposed through `APP_PORT`.

## What Gets Created On The VPS

`/opt/ai-agent-crm` contains:

- `docker-compose.yml`: uploaded from `deploy/docker-compose.vps.yml`.
- `.env`: rendered by the workflow from GitHub secrets and variables.
- `redis-data/`: bound to Redis append-only data.
- `backups/`: mounted into the web container at `/app/backups`.

Only the web app port is exposed by this stack. The existing external Postgres container keeps its own lifecycle and storage.

## Deploy

Push to `main`, or run the `Deploy VPS` workflow manually and set `app_port`.

After deployment, the workflow checks:

```bash
curl http://127.0.0.1:<APP_PORT>/api/health
```

On the VPS you can inspect the stack with:

```bash
cd /opt/ai-agent-crm
docker compose ps
docker compose logs -f web
docker compose logs -f worker
docker compose logs -f email-sync
```

Before a risky upgrade, create a backup:

```bash
cd /opt/ai-agent-crm
docker compose exec web node scripts/db-backup.mjs --mode=direct --output /app/backups/pre-upgrade.dump
```
