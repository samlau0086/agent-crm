#!/bin/sh
set -eu

node scripts/validate-env.mjs
node scripts/wait-for-database.mjs

exec node --experimental-strip-types --import ./scripts/register-alias.mjs scripts/email-sync.ts --loop
