export const dynamic = "force-dynamic";

import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { customerLevelSettingsUpdateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

async function getApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    return ok(await getCrmRepository().getCustomerLevelSettings(context));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/customer-level-settings", getApiMetricsHandler);

async function patchApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, customerLevelSettingsUpdateSchema);
    return ok(await getCrmRepository().updateCustomerLevelSettings(context, body));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const PATCH = withApiMetrics("PATCH /api/customer-level-settings", patchApiMetricsHandler);
