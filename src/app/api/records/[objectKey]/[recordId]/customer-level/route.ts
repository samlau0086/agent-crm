export const dynamic = "force-dynamic";

import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { customerLevelChangeRequestSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

type RouteContext = {
  params: Promise<{ objectKey: string; recordId: string }>;
};

async function patchApiMetricsHandler(request: NextRequest, routeContext: RouteContext) {
  try {
    const context = await getRequestContext(request);
    const { objectKey, recordId } = await routeContext.params;
    const body = await parseJson(request, customerLevelChangeRequestSchema);
    return ok(await getCrmRepository().requestCustomerLevelChange(context, objectKey, recordId, body));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const PATCH = withApiMetrics("PATCH /api/records/[objectKey]/[recordId]/customer-level", patchApiMetricsHandler);
