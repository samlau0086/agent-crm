import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, withApiMetrics } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";

export const dynamic = "force-dynamic";

async function getApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const status = new URL(request.url).searchParams.get("status");
    return ok(await getCrmRepository().listRecordChangeRequests(context, status === "approved" || status === "rejected" || status === "cancelled" || status === "all" ? status : "pending"));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/record-change-requests", getApiMetricsHandler);
