
export const dynamic = "force-dynamic";
﻿import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { activityCreateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

async function getApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const recordId = request.nextUrl.searchParams.get("recordId") ?? undefined;
    return ok(await getCrmRepository().listActivities(context, recordId));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/activities", getApiMetricsHandler);

async function postApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, activityCreateSchema);
    return ok(await getCrmRepository().createActivity(context, { ...body, recordId: body.recordId ?? undefined }), { status: 201 });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const POST = withApiMetrics("POST /api/activities", postApiMetricsHandler);
