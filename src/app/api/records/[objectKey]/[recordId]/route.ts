
export const dynamic = "force-dynamic";
﻿import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, parseOptionalJson, withApiMetrics } from "@/lib/api";
import { recordDeleteRequestSchema, recordPatchWithReasonSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

interface RouteParams {
  params: { objectKey: string; recordId: string };
}

async function getApiMetricsHandler(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    return ok(await getCrmRepository().getRecord(context, params.objectKey, params.recordId));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/records/[objectKey]/[recordId]", getApiMetricsHandler);

async function patchApiMetricsHandler(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, recordPatchWithReasonSchema);
    const { changeReason, ...patch } = body;
    if (params.objectKey === "contacts" || params.objectKey === "companies") {
      const approvalRequest = await getCrmRepository().requestRecordUpdate(context, params.objectKey, params.recordId, {
        ...patch,
        stageKey: patch.stageKey ?? undefined,
        ownerId: patch.ownerId ?? undefined
      }, changeReason ?? "");
      return ok({ pendingApproval: true, request: approvalRequest }, { status: 202 });
    }
    return ok(
      await getCrmRepository().updateRecord(context, params.objectKey, params.recordId, {
        ...patch,
        stageKey: patch.stageKey ?? undefined,
        ownerId: patch.ownerId ?? undefined
      })
    );
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const PATCH = withApiMetrics("PATCH /api/records/[objectKey]/[recordId]", patchApiMetricsHandler);

async function deleteApiMetricsHandler(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    if (["contacts", "companies", "deals", "products", "quotes"].includes(params.objectKey)) {
      const body = await parseOptionalJson(request, recordDeleteRequestSchema, {});
      const approvalRequest = await getCrmRepository().requestRecordDelete(context, params.objectKey, params.recordId, body.changeReason ?? "");
      return ok({ pendingApproval: true, request: approvalRequest }, { status: 202 });
    }
    await getCrmRepository().deleteRecord(context, params.objectKey, params.recordId);
    return ok({ ok: true });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const DELETE = withApiMetrics("DELETE /api/records/[objectKey]/[recordId]", deleteApiMetricsHandler);
