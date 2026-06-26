import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, withApiMetrics } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";


export const dynamic = "force-dynamic";
async function postApiMetricsHandler(request: NextRequest, { params }: { params: { id: string; deliveryId: string } }) {
  try {
    const context = await getRequestContext(request);
    return ok(await getCrmRepository().retryWebhookDelivery(context, params.id, params.deliveryId), { status: 201 });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const POST = withApiMetrics("POST /api/webhooks/[id]/deliveries/[deliveryId]/retry", postApiMetricsHandler);
