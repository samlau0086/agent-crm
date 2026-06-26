import type { NextRequest } from "next/server";
import { emailThreadStateUpdateSchema } from "@/lib/crm/api-schemas";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";

export const dynamic = "force-dynamic";

async function patchApiMetricsHandler(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, emailThreadStateUpdateSchema);
    return ok(await getCrmRepository().updateEmailThreadState(context, params.id, body));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const PATCH = withApiMetrics("PATCH /api/email/threads/[id]/state", patchApiMetricsHandler);
