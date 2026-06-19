import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson } from "@/lib/api";
import { recordWriteSchema } from "@/lib/crm/api-schemas";
import { parseRecordListQuery } from "@/lib/crm/record-query";
import { getCrmRepository } from "@/lib/crm/repository";

interface RouteParams {
  params: { objectKey: string };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    return ok(await getCrmRepository().queryRecords(context, params.objectKey, parseRecordListQuery(request)));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, recordWriteSchema);
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
