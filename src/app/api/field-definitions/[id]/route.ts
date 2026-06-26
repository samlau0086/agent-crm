
export const dynamic = "force-dynamic";
﻿import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { fieldDefinitionUpdateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

interface RouteParams {
  params: { id: string };
}

async function patchApiMetricsHandler(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, fieldDefinitionUpdateSchema);
    return ok(await getCrmRepository().updateFieldDefinition(context, params.id, body));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const PATCH = withApiMetrics("PATCH /api/field-definitions/[id]", patchApiMetricsHandler);

async function deleteApiMetricsHandler(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    await getCrmRepository().deleteFieldDefinition(context, params.id);
    return ok({ ok: true });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const DELETE = withApiMetrics("DELETE /api/field-definitions/[id]", deleteApiMetricsHandler);
