export const dynamic = "force-dynamic";
import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { recordCreateSchema } from "@/lib/crm/api-schemas";
import { parseRecordListQuery } from "@/lib/crm/record-query";
import { getCrmRepository } from "@/lib/crm/repository";

interface RouteParams {
  params: { objectKey: string };
}

async function getRecords(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    return ok(await getCrmRepository().queryRecords(context, params.objectKey, parseRecordListQuery(request)));
  } catch (error) {
    return handleApiError(error, request);
  }
}

async function createRecord(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, recordCreateSchema);
    return ok(
      await getCrmRepository().createRecord(context, params.objectKey, {
        ...body,
        stageKey: body.stageKey ?? undefined,
        ownerId: body.ownerId ?? undefined
      }),
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/records/[objectKey]", getRecords);
export const POST = withApiMetrics("POST /api/records/[objectKey]", createRecord);
