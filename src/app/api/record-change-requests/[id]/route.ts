import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { recordChangeRequestReviewSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

export const dynamic = "force-dynamic";

async function patchApiMetricsHandler(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, recordChangeRequestReviewSchema);
    const repository = getCrmRepository();
    const reviewedRequest = await repository.reviewRecordChangeRequest(context, params.id, body);
    const updatedRecord =
      reviewedRequest.status === "approved" && reviewedRequest.action === "update" && reviewedRequest.objectKey !== "activities"
        ? await repository.getRecord(context, reviewedRequest.objectKey, reviewedRequest.recordId).catch(() => undefined)
        : undefined;
    return ok({ request: reviewedRequest, record: updatedRecord });
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
