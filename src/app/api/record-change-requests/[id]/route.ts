import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { recordChangeRequestReviewSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

export const dynamic = "force-dynamic";

async function patchApiMetricsHandler(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, recordChangeRequestReviewSchema);
    return ok(await getCrmRepository().reviewRecordChangeRequest(context, params.id, body));
  } catch (error) {
    return handleApiError(error, request);
  }
}

async function deleteApiMetricsHandler(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    return ok(await getCrmRepository().cancelRecordChangeRequest(context, params.id));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const PATCH = withApiMetrics("PATCH /api/record-change-requests/[id]", patchApiMetricsHandler);
export const DELETE = withApiMetrics("DELETE /api/record-change-requests/[id]", deleteApiMetricsHandler);
