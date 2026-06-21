import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkEmailSubsystemDiagnostics } from "@/lib/email/diagnostics";
import { checkJobHealth, toSafeDatabaseHealthError } from "@/lib/ops/health";
import { buildServiceHealthPayload } from "@/lib/ops/service-health";

export const dynamic = "force-dynamic";

export async function GET() {
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
