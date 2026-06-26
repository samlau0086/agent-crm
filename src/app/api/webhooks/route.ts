import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { webhookCreateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";


export const dynamic = "force-dynamic";
async function getApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    return ok(await getCrmRepository().listWebhooks(context));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/webhooks", getApiMetricsHandler);

async function postApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, webhookCreateSchema);
    return ok(await getCrmRepository().createWebhook(context, body), { status: 201 });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const POST = withApiMetrics("POST /api/webhooks", postApiMetricsHandler);
