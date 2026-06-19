import { PrismaClient } from "@prisma/client";

const timeoutMs = Number(process.env.DB_WAIT_TIMEOUT_MS ?? 60000);
const intervalMs = Number(process.env.DB_WAIT_INTERVAL_MS ?? 2000);
const startedAt = Date.now();
let attempt = 0;

while (Date.now() - startedAt < timeoutMs) {
  attempt += 1;
  const prisma = new PrismaClient();
  try {
    await prisma.$queryRaw`SELECT 1`;
    await prisma.$disconnect();
    console.log(`Database is ready after ${attempt} attempt(s).`);
    process.exit(0);
  } catch (error) {
    await prisma.$disconnect().catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    console.log(`Waiting for database (${attempt}): ${message}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

console.error(`Database did not become ready within ${timeoutMs}ms.`);
process.exit(1);
