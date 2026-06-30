import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, parseOptionalJson, withApiMetrics } from "@/lib/api";
import { activityUpdateSchema, recordDeleteRequestSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: { id: string };
}

async function getApiMetricsHandler(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    return ok(await getCrmRepository().getActivity(context, params.id));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/activities/[id]", getApiMetricsHandler);

async function patchApiMetricsHandler(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, activityUpdateSchema);
    return ok(await getCrmRepository().updateActivity(context, params.id, body));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const PATCH = withApiMetrics("PATCH /api/activities/[id]", patchApiMetricsHandler);

async function deleteApiMetricsHandler(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    const body = await parseOptionalJson(request, recordDeleteRequestSchema, {});
    const approvalRequest = await getCrmRepository().requestActivityDelete(context, params.id, body.changeReason ?? "");
    return ok({ pendingApproval: true, request: approvalRequest }, { status: 202 });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const DELETE = withApiMetrics("DELETE /api/activities/[id]", deleteApiMetricsHandler);
