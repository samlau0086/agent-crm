import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson } from "@/lib/api";
import { webhookUpdateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, webhookUpdateSchema);
    return ok(await getCrmRepository().updateWebhook(context, params.id, body));
  } catch (error) {
    return handleApiError(error, request);
  }
}
