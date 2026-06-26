import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { activityUpdateSchema } from "@/lib/crm/api-schemas";
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
    await getCrmRepository().deleteActivity(context, params.id);
    return ok({ deleted: true });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const DELETE = withApiMetrics("DELETE /api/activities/[id]", deleteApiMetricsHandler);
