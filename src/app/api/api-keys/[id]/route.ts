import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { apiKeyUpdateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";


export const dynamic = "force-dynamic";
async function patchApiMetricsHandler(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, apiKeyUpdateSchema);
    if (body.action === "revoke") {
      return ok(await getCrmRepository().revokeApiKey(context, params.id));
    }
    return ok(await getCrmRepository().revokeApiKey(context, params.id));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const PATCH = withApiMetrics("PATCH /api/api-keys/[id]", patchApiMetricsHandler);
