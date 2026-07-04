export const dynamic = "force-dynamic";

import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, withApiMetrics } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";

type RouteContext = {
  params: Promise<{ objectKey: string; recordId: string }>;
};

async function postApiMetricsHandler(request: NextRequest, routeContext: RouteContext) {
  try {
    const context = await getRequestContext(request);
    const { objectKey, recordId } = await routeContext.params;
    return ok(await getCrmRepository().suggestCustomerLevel(context, objectKey, recordId));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const POST = withApiMetrics("POST /api/records/[objectKey]/[recordId]/customer-level/suggest", postApiMetricsHandler);
