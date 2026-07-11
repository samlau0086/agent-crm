import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { salesDocumentConvertSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: { objectKey: string; recordId: string };
}

async function convertRecord(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, salesDocumentConvertSchema);
    return ok(await getCrmRepository().convertSalesDocument(context, params.objectKey, params.recordId, body.targetObjectKey), { status: 201 });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const POST = withApiMetrics("POST /api/records/[objectKey]/[recordId]/convert", convertRecord);
