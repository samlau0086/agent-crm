set -eu
cd "$DEPLOY_PATH"
if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="${VPS_SUDO:-sudo}"
fi
resolve_ghcr() {
  getent hosts ghcr.io >/dev/null 2>&1 \
    || { command -v resolvectl >/dev/null 2>&1 && resolvectl query ghcr.io >/dev/null 2>&1; } \
    || { command -v nslookup >/dev/null 2>&1 && nslookup ghcr.io >/dev/null 2>&1; }
}
restart_system_resolver() {
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files systemd-resolved.service >/dev/null 2>&1; then
    echo "Restarting systemd-resolved after GHCR DNS lookup failure"
    $SUDO systemctl restart systemd-resolved || true
    sleep 2
  fi
}
docker_login_ghcr() {
  printf '%s\n' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
}
if ! resolve_ghcr; then
  restart_system_resolver
  if ! resolve_ghcr; then
    echo "::error title=VPS DNS cannot resolve GHCR::The VPS cannot resolve ghcr.io before Docker login. Check systemd-resolved or /etc/resolv.conf DNS settings."
    exit 1
  fi
fi
if [ -n "${GHCR_TOKEN:-}" ]; then
  login_stderr="$(mktemp)"
  set +e
  docker_login_ghcr 2>"$login_stderr"
  login_code="$?"
  set -e
  if [ "$login_code" -ne 0 ]; then
    if grep -Eiq 'lookup ghcr\.io|server misbehaving|EAI_AGAIN|temporary failure' "$login_stderr"; then
      cat "$login_stderr" >&2
      restart_system_resolver
      resolve_ghcr || {
        echo "::error title=VPS DNS cannot resolve GHCR::Docker login failed because the VPS DNS resolver cannot resolve ghcr.io."
        rm -f "$login_stderr"
        exit 1
      }
      docker_login_ghcr
    else
      cat "$login_stderr" >&2
      rm -f "$login_stderr"
      exit "$login_code"
    fi
  fi
  rm -f "$login_stderr"
fi
docker compose config >/dev/null
postgres_host="$(grep -E '^POSTGRES_HOST=' .env | sed -E "s/^POSTGRES_HOST='?([^']*)'?.*/\1/")"
postgres_port="$(grep -E '^POSTGRES_PORT=' .env | sed -E "s/^POSTGRES_PORT='?([^']*)'?.*/\1/")"
if [ "${postgres_host:-postgres}" != "postgres" ]; then
  docker run --rm --add-host=host.docker.internal:host-gateway alpine:3.20 sh -c "nc -z -w 5 '${postgres_host}' '${postgres_port:-5432}'"
  set -a
  . ./.env
  set +a
  psql_url="${DATABASE_URL%%\?*}"
  schema_name="$(printf '%s' "$DATABASE_URL" | sed -n "s/.*[?&]schema=\([^&]*\).*/\1/p")"
  schema_name="${schema_name:-public}"
  if ! printf '%s' "$schema_name" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]*$'; then
    echo "::error title=Invalid Postgres schema::DATABASE_URL schema must be a simple PostgreSQL identifier"
    exit 1
  fi
  schema_permission="$(docker run --rm --add-host=host.docker.internal:host-gateway postgres:16-alpine psql "$psql_url" -v ON_ERROR_STOP=1 -tAc "select case when has_schema_privilege(current_user, '$schema_name', 'USAGE') and has_schema_privilege(current_user, '$schema_name', 'CREATE') then 'ok' else 'missing_schema_privilege' end")"
  if [ "$schema_permission" != "ok" ]; then
    echo "::error title=Postgres schema permission denied::POSTGRES_USER must have USAGE and CREATE on schema ${schema_name}. Connect as a Postgres admin and run: GRANT USAGE, CREATE ON SCHEMA ${schema_name} TO ${POSTGRES_USER};"
    exit 1
  fi
fi
crm_image="$(grep -E '^CRM_IMAGE=' .env | sed -E "s/^CRM_IMAGE='?([^']*)'?.*/\1/")"
if [ -z "$crm_image" ]; then
  echo "::error title=Missing CRM image::CRM_IMAGE is missing from the deployed .env file"
  exit 1
fi
echo "===== docker compose pull start ====="
echo "Target CRM image: $crm_image"
set +e
docker compose pull
pull_code="$?"
set -e
if [ "$pull_code" -ne 0 ]; then
  echo "::error title=Docker compose pull failed::Failed to pull deployment images. Check the lines immediately above for GHCR/network/layer extraction errors."
  docker compose ps -a || true
  docker image inspect "$crm_image" --format 'local_image_id={{.Id}} local_digests={{json .RepoDigests}}' || true
  exit "$pull_code"
fi
echo "===== docker compose pull complete ====="
echo "Deploying CRM image: $crm_image"
docker image inspect "$crm_image" --format 'id={{.Id}} digests={{json .RepoDigests}}' || true
migration_path="prisma/migrations/20260707110000_company_domain_optional/migration.sql"
migration_sql="$(docker run --rm --entrypoint sh "$crm_image" -lc "cat \"$migration_path\"")"
echo "===== CRM image migration sanity check: $migration_path ====="
printf '%s\n' "$migration_sql" | sed -n '1,20p'
if printf '%s\n' "$migration_sql" | grep -q 'WHERE "objectKey"'; then
  echo "::error title=Stale CRM image migration::Image $crm_image still contains the old company domain migration SQL. Rebuild and push a fresh image before deploying."
  exit 1
fi
if ! printf '%s\n' "$migration_sql" | grep -q 'FROM "ObjectDefinition" object_definition'; then
  echo "::error title=Unexpected CRM image migration::Image $crm_image does not contain the expected fixed company domain migration SQL."
  exit 1
fi
tags_migration_path="prisma/migrations/20260711130000_record_activity_tags/migration.sql"
tags_migration_sql="$(docker run --rm --entrypoint sh "$crm_image" -lc "cat \"$tags_migration_path\"")"
echo "===== CRM image migration sanity check: $tags_migration_path ====="
printf '%s\n' "$tags_migration_sql" | sed -n '1,20p'
if ! printf '%s\n' "$tags_migration_sql" | grep -q 'ADD COLUMN IF NOT EXISTS "tagColors"'; then
  echo "::error title=Stale CRM image migration::Image $crm_image does not contain the idempotent tags migration SQL. Rebuild and push a fresh image before deploying."
  exit 1
fi
if ! docker run --rm --entrypoint sh "$crm_image" -lc "grep -q '20260711130000_record_activity_tags' scripts/recover-known-failed-migrations.mjs"; then
  echo "::error title=Stale migration recovery script::Image $crm_image cannot recover the tags migration if a previous deploy left it failed."
  exit 1
fi
ensure_tags_migration_path="prisma/migrations/20260711143000_ensure_record_activity_tags/migration.sql"
ensure_tags_migration_sql="$(docker run --rm --entrypoint sh "$crm_image" -lc "cat \"$ensure_tags_migration_path\"")"
echo "===== CRM image migration sanity check: $ensure_tags_migration_path ====="
printf '%s\n' "$ensure_tags_migration_sql" | sed -n '1,20p'
if ! printf '%s\n' "$ensure_tags_migration_sql" | grep -q 'ADD COLUMN IF NOT EXISTS "tagColors"'; then
  echo "::error title=Missing tags ensure migration::Image $crm_image does not contain the follow-up migration that repairs databases where the original tags migration already finished."
  exit 1
fi
if ! docker run --rm --entrypoint sh "$crm_image" -lc "grep -q '20260711143000_ensure_record_activity_tags' scripts/recover-known-failed-migrations.mjs"; then
  echo "::error title=Stale migration recovery script::Image $crm_image cannot recover the tags ensure migration if it fails."
  exit 1
fi
echo "===== prepare database services ====="
docker compose up -d postgres redis
echo "===== known failed migration recovery ====="
docker compose run --rm --no-deps --entrypoint sh web -lc 'node scripts/wait-for-database.mjs && node scripts/recover-known-failed-migrations.mjs'
dump_diagnostics() {
  echo "===== docker compose ps -a ====="
  docker compose ps -a || true
  echo "===== web container state ====="
  docker inspect --format 'status={{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} error={{.State.Error}}' ai-agent-crm-web-1 || true
  echo "===== web health inspect ====="
  docker inspect --format '{{json .State.Health}}' ai-agent-crm-web-1 || true
  echo "===== web logs ====="
  docker compose logs --no-color --since=20m --tail=200 web || true
  echo "===== worker logs ====="
  docker compose logs --no-color --since=20m --tail=120 worker || true
  echo "===== email-sync logs ====="
  docker compose logs --no-color --since=20m --tail=120 email-sync || true
  echo "===== redis logs ====="
  docker compose logs --no-color --since=20m --tail=80 redis || true
  echo "===== postgres logs ====="
  docker compose logs --no-color --since=20m --tail=120 postgres || true
}
set +e
docker compose up -d --remove-orphans
compose_up_code="$?"
set -e
if [ "$compose_up_code" -ne 0 ]; then
  dump_diagnostics
  exit "$compose_up_code"
fi
docker compose ps
docker compose exec -T web node scripts/healthcheck.mjs || {
  health_code="$?"
  dump_diagnostics
  exit "$health_code"
}
docker compose exec -T web node scripts/verify-crm-tags-schema.mjs
email_verify_args=""
[ "${REQUIRE_LIVE_EMAIL_READINESS:-false}" = "true" ] && email_verify_args="$email_verify_args --require-live-readiness"
[ "${REQUIRE_LIVE_EMAIL_READINESS:-false}" = "true" ] || [ "${RUN_EMAIL_CONNECTION_TESTS:-false}" != "true" ] || email_verify_args="$email_verify_args --test-connections"
[ "${REQUIRE_LIVE_EMAIL_READINESS:-false}" = "true" ] || [ "${RUN_EMAIL_AI_PROVIDER_TEST:-false}" != "true" ] || email_verify_args="$email_verify_args --test-ai-provider"
[ "${REQUIRE_LIVE_EMAIL_READINESS:-false}" = "true" ] || [ "${RUN_EMAIL_SMOKE_TEST:-false}" != "true" ] || email_verify_args="$email_verify_args --smoke"
verify_stdout="$(mktemp)"
verify_stderr="$(mktemp)"
rm -f email-verify-last.json email-verify-last-summary.txt
set +e
docker compose exec -T web node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/email-verify.ts $email_verify_args >"$verify_stdout" 2>"$verify_stderr"
verify_code="$?"
set -e
cat "$verify_stderr" >&2
[ ! -s "$verify_stderr" ] || {
  cp "$verify_stderr" email-verify-last-summary.txt
  chmod 600 email-verify-last-summary.txt
}
[ ! -s "$verify_stdout" ] || {
  cp "$verify_stdout" email-verify-last.json
  chmod 600 email-verify-last.json
  cat "$verify_stdout"
}
rm -f "$verify_stdout" "$verify_stderr"
exit "$verify_code"
