import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, withApiMetrics } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";
import { checkEmailSubsystemDiagnosticsForContext } from "@/lib/email/diagnostics";

export const dynamic = "force-dynamic";

async function getApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    return ok(await checkEmailSubsystemDiagnosticsForContext(context, getCrmRepository(), { includeJobs: true }));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/email/diagnostics", getApiMetricsHandler);
