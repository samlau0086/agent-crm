import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkJobHealth, toSafeHealthError } from "@/lib/ops/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const checkedAt = new Date().toISOString();
  let database: "ok" | "error" = "ok";
  const errors: string[] = [];

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    database = "error";
    errors.push(toSafeHealthError(error, "Database health check failed"));
  }

  const jobs = await checkJobHealth();
  if (!jobs.ok && jobs.error) {
    errors.push(jobs.error);
  }

  const ok = database === "ok" && jobs.ok;

  return NextResponse.json(
    {
      ok,
      service: "ai-agent-crm",
      database,
      jobs,
      error: errors.length > 0 ? errors.join("; ") : undefined,
      checkedAt
    },
    { status: ok ? 200 : 503 }
  );
}
