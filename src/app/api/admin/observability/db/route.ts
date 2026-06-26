import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, withApiMetrics } from "@/lib/api";
import { requirePermission } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { getDatabaseObservabilitySnapshot } from "@/lib/ops/observability";

export const dynamic = "force-dynamic";

async function getDatabaseObservability(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    requirePermission(context, "crm.admin");
    return ok(await getDatabaseObservabilitySnapshot(prisma));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/admin/observability/db", getDatabaseObservability);
