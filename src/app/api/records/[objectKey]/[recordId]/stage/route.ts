import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { recordStageUpdateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: { objectKey: string; recordId: string };
}

async function patchApiMetricsHandler(request: NextRequest, { params }: RouteParams) {
  try {
    if (params.objectKey !== "deals") {
      throw new Error("Only deals support pipeline stage updates");
    }
    const context = await getRequestContext(request);
    const body = await parseJson(request, recordStageUpdateSchema);
    return ok(
      await getCrmRepository().updateRecord(context, params.objectKey, params.recordId, {
        stageKey: body.stageKey ?? undefined,
        ...(typeof body.pipelineOrder === "number" ? { data: { pipelineOrder: body.pipelineOrder } } : {})
      })
    );
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const PATCH = withApiMetrics("PATCH /api/records/[objectKey]/[recordId]/stage", patchApiMetricsHandler);
