export const dynamic = "force-dynamic";

import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { customerLevelSuggestionGenerateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

async function postApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, customerLevelSuggestionGenerateSchema);
    return ok(await getCrmRepository().generateCustomerLevelSuggestions(context, body));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const POST = withApiMetrics("POST /api/customer-level-suggestions/generate", postApiMetricsHandler);
