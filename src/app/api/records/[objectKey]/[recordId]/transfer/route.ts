export const dynamic = "force-dynamic";

import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { recordPoolTransferSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

interface RouteParams {
  params: { objectKey: string; recordId: string };
}

async function postApiMetricsHandler(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, recordPoolTransferSchema);
    return ok(await getCrmRepository().transferRecord(context, params.objectKey, params.recordId, body.ownerId ?? null));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const POST = withApiMetrics("POST /api/records/[objectKey]/[recordId]/transfer", postApiMetricsHandler);
