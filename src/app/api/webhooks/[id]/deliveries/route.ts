import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, withApiMetrics } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";
import type { WebhookDeliveryStatus } from "@/lib/crm/types";
import { isValidWebhookEvent, type WebhookEvent } from "@/lib/integrations/webhook";


export const dynamic = "force-dynamic";
const deliveryStatuses = new Set<WebhookDeliveryStatus>(["pending", "success", "failed"]);

async function getApiMetricsHandler(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get("status")?.trim() as WebhookDeliveryStatus | undefined;
    const event = searchParams.get("event")?.trim() as WebhookEvent | undefined;
    const limit = Number(searchParams.get("limit") ?? 50);

    return ok(
      await getCrmRepository().listWebhookDeliveries(context, params.id, {
        status: status && deliveryStatuses.has(status) ? status : undefined,
        event: event && isValidWebhookEvent(event) ? event : undefined,
        limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 50
      })
    );
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/webhooks/[id]/deliveries", getApiMetricsHandler);
