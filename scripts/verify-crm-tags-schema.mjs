#!/usr/bin/env node
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const rows = await prisma.$queryRaw`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name IN ('CrmRecord', 'Activity')
      AND column_name IN ('tags', 'tagColors')
  `;
  const found = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
  const required = ["CrmRecord.tags", "CrmRecord.tagColors", "Activity.tags", "Activity.tagColors"];
  const missing = required.filter((column) => !found.has(column));
  if (missing.length > 0) {
    throw new Error(`Missing CRM tag schema columns: ${missing.join(", ")}`);
  }
  console.log("CRM tag schema columns verified.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
