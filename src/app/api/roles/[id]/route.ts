
export const dynamic = "force-dynamic";
﻿import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { roleUpdateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

interface RouteParams {
  params: { id: string };
}

async function patchApiMetricsHandler(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, roleUpdateSchema);
    return ok(await getCrmRepository().updateRole(context, params.id, body));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const PATCH = withApiMetrics("PATCH /api/roles/[id]", patchApiMetricsHandler);

async function deleteApiMetricsHandler(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    await getCrmRepository().deleteRole(context, params.id);
    return ok({ ok: true });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const DELETE = withApiMetrics("DELETE /api/roles/[id]", deleteApiMetricsHandler);
