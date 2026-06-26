import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, withApiMetrics } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";
import { testEmailAccountConnections } from "@/lib/email/connection-tests";

export const dynamic = "force-dynamic";

async function postApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const repository = getCrmRepository();
    return ok(await testEmailAccountConnections(context, repository));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const POST = withApiMetrics("POST /api/email/test-connections", postApiMetricsHandler);
