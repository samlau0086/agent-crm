#!/usr/bin/env node
import { spawnSync } from "node:child_process";

import { PrismaClient } from "@prisma/client";

const recoverableMigrations = new Set([
  "20260707110000_company_domain_optional",
  "20260711130000_record_activity_tags",
]);

const prisma = new PrismaClient();

function isMissingMigrationTableError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    error?.code === "P2010" &&
    (error?.meta?.code === "42P01" || message.includes('relation "_prisma_migrations" does not exist'))
  );
}

async function getLatestMigrationRow(migrationName) {
  let rows;
  try {
    rows = await prisma.$queryRawUnsafe(
      `SELECT migration_name, started_at, finished_at, rolled_back_at, logs
       FROM "_prisma_migrations"
       WHERE migration_name = $1
       ORDER BY started_at DESC
       LIMIT 1`,
      migrationName,
    );
  } catch (error) {
    if (isMissingMigrationTableError(error)) {
      console.log("Prisma migration table does not exist yet; recovery not needed.");
      return null;
    }
    throw error;
  }

  return rows[0] ?? null;
}

function runPrismaResolve(migrationName) {
  const result = spawnSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "resolve", "--rolled-back", migrationName],
    {
      env: process.env,
      stdio: "inherit",
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function recoverMigration(migrationName) {
  if (!recoverableMigrations.has(migrationName)) {
    throw new Error(`Refusing to recover unknown migration: ${migrationName}`);
  }

  const row = await getLatestMigrationRow(migrationName);
  if (!row) {
    console.log(`No migration row found for ${migrationName}; recovery not needed.`);
    return;
  }

  if (row.finished_at) {
    console.log(`Migration ${migrationName} is already finished; recovery not needed.`);
    return;
  }

  if (row.rolled_back_at) {
    console.log(`Migration ${migrationName} is already marked rolled back; recovery not needed.`);
    return;
  }

  console.log(`Recovering failed Prisma migration ${migrationName}.`);
  if (row.started_at) {
    console.log(`Failed migration started at ${row.started_at.toISOString?.() ?? row.started_at}.`);
  }
  if (row.logs) {
    console.log("Stored migration error excerpt:");
    console.log(String(row.logs).split("\n").slice(0, 8).join("\n"));
  }

  runPrismaResolve(migrationName);
  console.log(`Migration ${migrationName} marked rolled back. The next migrate deploy will retry it.`);
}

async function main() {
  const requestedMigrations = process.argv.slice(2);
  const migrations = requestedMigrations.length > 0 ? requestedMigrations : Array.from(recoverableMigrations);

  for (const migrationName of migrations) {
    await recoverMigration(migrationName);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
