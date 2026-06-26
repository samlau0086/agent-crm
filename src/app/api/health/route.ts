import { NextResponse } from "next/server";
import { withApiMetrics } from "@/lib/api";
import { checkEmailSubsystemDiagnostics } from "@/lib/email/diagnostics";
import { checkJobHealth, toSafeDatabaseHealthError } from "@/lib/ops/health";
import { buildServiceHealthPayload } from "@/lib/ops/service-health";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

async function getHealth() {
  const checkedAt = new Date().toISOString();
  let database: "ok" | "error" = "ok";
  const errors: string[] = [];

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    database = "error";
    errors.push(toSafeDatabaseHealthError(error));
  }

  const jobs = await checkJobHealth();
  if (!jobs.ok && jobs.error) {
    errors.push(jobs.error);
  }

  const email = await checkEmailSubsystemDiagnostics();
  if (!email.ok) {
    errors.push("Email subsystem diagnostics failed");
  }

  const payload = buildServiceHealthPayload({
    checkedAt,
    database,
    jobs,
    email,
    errors
  });

  return NextResponse.json(
    payload,
    { status: payload.ok ? 200 : 503 }
  );
}

export const GET = withApiMetrics("GET /api/health", getHealth);
