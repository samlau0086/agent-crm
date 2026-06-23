# GitHub Actions VPS Deployment

This workflow deploys the CRM to one VPS with Docker Compose. It builds the application image in GitHub Actions, pushes it to GHCR, then connects to the VPS over SSH and runs the stack from `/opt/ai-agent-crm`.

## VPS Prerequisites

- Docker Engine with the Compose plugin installed.
- An SSH user that can write to `/opt/ai-agent-crm`, or can run passwordless `sudo`.
- Inbound firewall access to the chosen app port, for example `3000`.
- Enough disk space under `/opt/ai-agent-crm` for Postgres, Redis data, and backups.

## Required GitHub Secrets

- `VPS_HOST`: VPS IP or hostname.
- `VPS_USER`: SSH user.
- `VPS_SSH_KEY`: private key for that user.
- `POSTGRES_PASSWORD`: stable database password. The workflow URL-encodes it when rendering `DATABASE_URL`; do not rotate it casually after data exists.
- `EMAIL_CONFIG_SECRET`: stable mailbox credential encryption secret.
- `EMAIL_OAUTH_STATE_SECRET`: stable OAuth state signing secret.

Optional secrets:

- `VPS_PORT`: SSH port, defaults to `22`. Prefer the repository variable of the same name unless you intentionally want to hide the port.
- `APP_BASE_URL`: external CRM origin, for example `https://crm.example.com`. Prefer the repository variable of the same name unless you intentionally want to hide the URL.
- `GHCR_USERNAME` and `GHCR_TOKEN`: use a token with `read:packages` when the GHCR package is private and the default workflow token cannot pull it from the VPS.
- `AI_API_KEY`: required when `RUN_EMAIL_AI_PROVIDER_TEST=true` or `REQUIRE_LIVE_EMAIL_READINESS=true`; otherwise AI features use the local read-only fallback when the key is absent.
- `GMAIL_OAUTH_CLIENT_ID` and `GMAIL_OAUTH_CLIENT_SECRET`: configure both when using Gmail OAuth. Supplying only one of the pair fails deployment validation.
- `OUTLOOK_OAUTH_CLIENT_ID` and `OUTLOOK_OAUTH_CLIENT_SECRET`: configure both when using Outlook OAuth. Supplying only one of the pair fails deployment validation.

Optional repository variables:

- `VPS_APP_PORT`: host port exposed by Compose; workflow dispatch input `app_port` overrides it.
- `VPS_PORT`: SSH port, default `22`; this variable takes precedence over the legacy secret.
- `APP_BASE_URL`: external CRM origin, for example `https://crm.example.com`; this variable takes precedence over the legacy secret. If omitted, the workflow uses `http://VPS_HOST:APP_PORT`.
- `ALLOW_INSECURE_APP_BASE_URL`: defaults to `true` only for direct `http://ip:port` deployments. Set it to `false` when using HTTPS.
- `POSTGRES_HOST`, default `postgres` for the managed pgvector service.
- `POSTGRES_PORT`, default `5432`.
- `POSTGRES_DB`, `POSTGRES_USER`, `SEED_ON_EMPTY`, `EMAIL_DELIVERY_MODE`, `EMAIL_SYNC_INTERVAL_MS`, `EMAIL_SYNC_LIMIT`, `EMAIL_SYNC_USER_ID`, `EMAIL_VERIFY_USER_ID`, `EMAIL_SEND_CLAIM_TIMEOUT_MS`, `AI_PROVIDER`, `AI_BASE_URL`, `AI_MODEL`, `AI_TIMEOUT_MS`, `GMAIL_OAUTH_SCOPE`, `OUTLOOK_OAUTH_SCOPE`.
- `RUN_EMAIL_CONNECTION_TESTS`, `RUN_EMAIL_AI_PROVIDER_TEST`, `RUN_EMAIL_SMOKE_TEST`: set to `true` to make every automatic deployment run the corresponding `email:verify` gate.
- `REQUIRE_LIVE_EMAIL_READINESS`: set to `true` to fail deployment unless `email:verify --require-live-readiness` reports `readiness.liveTrafficReady=true`. This verifier mode automatically runs real mailbox connection checks, AI provider generation checks, and smoke checks, so the three individual `RUN_EMAIL_*` variables are not required when this is enabled.
- `VPS_SUDO`: defaults to `sudo`. Set it to an empty value when the SSH user is root and the image does not include sudo.

## Pre-Deployment Validation

Before opening an SSH connection, the workflow rejects common configuration mistakes:

- Missing required VPS/Postgres/email secrets.
- `EMAIL_CONFIG_SECRET` or `EMAIL_OAUTH_STATE_SECRET` shorter than 16 characters, still using a placeholder, or using the same value.
- `AI_API_KEY` missing while AI provider verification or live email readiness is enabled.
- Gmail or Outlook OAuth client id configured without the matching client secret, or the reverse.
- `EMAIL_DELIVERY_MODE` not set to `live` or `dry-run`, or live readiness enabled while delivery mode is not `live`.
- `EMAIL_SYNC_INTERVAL_MS`, `EMAIL_SYNC_LIMIT`, or `EMAIL_SEND_CLAIM_TIMEOUT_MS` outside the accepted ranges.
- Invalid app port, Postgres port, Postgres identifier, or `SEED_ON_EMPTY` value.

After rendering `vps.env`, GitHub Actions also runs `NODE_ENV=production node scripts/validate-env.mjs --env-file vps.env` before uploading files to the VPS. The container still runs `node scripts/validate-env.mjs` at startup and during `deploy:verify`, so local, rendered-env, container, and GitHub Actions checks enforce the same AI/OAuth pairing and production URL/scope rules.

## Ports And Database Identity

- Web host port: `APP_PORT`, supplied by manual workflow input `app_port`, repository variable `VPS_APP_PORT`, or default `3000`.
- SSH port: repository variable `VPS_PORT`, GitHub secret `VPS_PORT`, or default `22`.
- Postgres host from CRM containers: repository variable `POSTGRES_HOST`, default `postgres`.
- Postgres port from CRM containers: repository variable `POSTGRES_PORT`, default `5432`.
- Postgres user: repository variable `POSTGRES_USER`, default `crm`.
- Postgres database: repository variable `POSTGRES_DB`, default `ai_agent_crm`.
- Postgres password: GitHub secret `POSTGRES_PASSWORD`.
- Generated database URL: `postgresql://POSTGRES_USER:POSTGRES_PASSWORD@POSTGRES_HOST:POSTGRES_PORT/POSTGRES_DB?schema=public`, with user, password, and database name URL-encoded by the workflow.

By default the VPS Compose stack starts a dedicated `pgvector/pgvector:pg16` container named `postgres`, stores data under `/opt/ai-agent-crm/postgres-data`, and keeps the database private to the Compose network. This avoids cross-container ownership drift and leaves the database ready for future vector search features.

The workflow keeps `/opt/ai-agent-crm` writable by the SSH deployment user, but sets `/opt/ai-agent-crm/postgres-data` and `/opt/ai-agent-crm/redis-data` to UID/GID `999:999` with mode `700` before every deploy because the managed Postgres and Redis containers own those data directories internally.

If the Postgres logs show `global/pg_filenode.map: Permission denied` or `postmaster.pid: Permission denied`, repair the existing directory with:

```bash
sudo chown -R 999:999 /opt/ai-agent-crm/postgres-data
sudo chmod 700 /opt/ai-agent-crm/postgres-data
```

If Redis health or the app health check reports `MISCONF Redis is configured to save RDB snapshots` and the Redis logs show `Failed opening the temp RDB file ... Permission denied`, repair the Redis directory with:

```bash
sudo chown -R 999:999 /opt/ai-agent-crm/redis-data
sudo chmod 700 /opt/ai-agent-crm/redis-data
```

Then rerun the deployment.

If you intentionally keep an external Postgres container mapped as `5433:5432` on the VPS host, set `POSTGRES_HOST=host.docker.internal` and `POSTGRES_PORT=5433`. The VPS compose file keeps `host.docker.internal:host-gateway` so Linux containers can reach a host-published external database.

The configured `POSTGRES_USER` must have `USAGE` and `CREATE` on the target schema, because Prisma migrations create `_prisma_migrations` and CRM tables in `public`. If deployment fails with `permission denied for schema public`, connect to the target database as a Postgres administrator and run:

```sql
GRANT CONNECT ON DATABASE ai_agent_crm TO crm;
GRANT USAGE, CREATE ON SCHEMA public TO crm;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO crm;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO crm;
```

For a dedicated fresh database, prefer creating or transferring ownership to the CRM user:

```sql
CREATE DATABASE ai_agent_crm OWNER crm;
-- or, for an existing dedicated database:
ALTER DATABASE ai_agent_crm OWNER TO crm;
ALTER SCHEMA public OWNER TO crm;
```

Postgres and Redis are managed by this CRM Compose stack and are private to the Compose network. Only the web app is exposed through `APP_PORT`.

## What Gets Created On The VPS

`/opt/ai-agent-crm` contains:

- `docker-compose.yml`: uploaded from `deploy/docker-compose.vps.yml`.
- `.env`: rendered by the workflow from GitHub secrets and variables.
- `postgres-data/`: bound to the managed `pgvector/pgvector:pg16` database.
- `redis-data/`: bound to Redis append-only data.
- `backups/`: mounted into the web container at `/app/backups`.

Only the web app port is exposed by this stack.

## Deploy

Push to `main`, or run the `Deploy VPS` workflow manually and set `app_port`.

After deployment, the workflow checks:

```bash
curl http://127.0.0.1:<APP_PORT>/api/health
```

It then runs the email deployment verifier inside the `web` container:

```bash
docker compose exec -T web node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/email-verify.ts
```

Manual workflow inputs can add `--test-connections`, `--test-ai-provider`, `--smoke`, and `--require-live-readiness`. For push deployments, set repository variables `RUN_EMAIL_CONNECTION_TESTS=true`, `RUN_EMAIL_AI_PROVIDER_TEST=true`, `RUN_EMAIL_SMOKE_TEST=true`, or `REQUIRE_LIVE_EMAIL_READINESS=true` to enforce the same gates automatically. `REQUIRE_LIVE_EMAIL_READINESS=true` is intentionally stricter than the individual checks: it runs the real mailbox tests, AI provider verification from an actual generation call, and application smoke verification, then fails unless diagnostics, live delivery mode, and all three runtime checks together produce `readiness.liveTrafficReady=true`.

The workflow removes stale verifier artifacts before each run, then stores the most recent machine-readable verifier output on the VPS as `/opt/ai-agent-crm/email-verify-last.json` with mode `600`. It also stores the compact stderr readiness summary as `/opt/ai-agent-crm/email-verify-last-summary.txt` with mode `600`. The JSON file is written even when `email:verify` returns `ok=false`, as long as the verifier produced JSON, so deployment failures can be inspected without searching the full GitHub Actions log. If the verifier crashes before producing JSON, the old JSON file is not left behind. Connection-test results in the JSON file are whitelisted to status fields such as `smtp`, `imap`, `oauth`, and `oauthAccountEmail`; raw provider responses and credentials are not persisted. Verifier error text is also redacted for common token, password, client secret, API key, authorization header, JWT, and OpenAI-style key patterns before it is printed or saved.

To inspect the last verifier result on the VPS without installing `jq`:

```bash
cd /opt/ai-agent-crm
docker compose exec -T web node scripts/email-verify-report.mjs --file /dev/stdin --fail-on-not-ready=false < email-verify-last.json
cat email-verify-last-summary.txt
```

The verifier tries `EMAIL_VERIFY_USER_ID`, then `EMAIL_SYNC_USER_ID`, then `user-admin`, and falls back to the first active `crm.admin` user if that configured id is not available. Set `EMAIL_VERIFY_USER_ID` when you want a specific production admin identity in audit context. For a brand-new empty database, either run your own bootstrap process first or set `SEED_ON_EMPTY=true` temporarily to load the built-in demo/admin seed, then switch it back to `false`.

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
