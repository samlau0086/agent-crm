#!/bin/sh
set -eu

if [ "${SKIP_ENV_VALIDATION:-false}" != "true" ]; then
  node scripts/validate-env.mjs
fi

if [ "${WAIT_FOR_DATABASE:-true}" = "true" ]; then
  node scripts/wait-for-database.mjs
fi

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  node node_modules/prisma/build/index.js migrate deploy
fi

if [ "${SEED_ON_EMPTY:-false}" = "true" ]; then
  node scripts/seed-if-empty.mjs
fi

exec node server.js
