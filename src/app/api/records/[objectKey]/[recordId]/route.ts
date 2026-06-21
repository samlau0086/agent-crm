
export const dynamic = "force-dynamic";
﻿import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson } from "@/lib/api";
import { recordPatchSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

interface RouteParams {
  params: { objectKey: string; recordId: string };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    return ok(await getCrmRepository().getRecord(context, params.objectKey, params.recordId));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, recordPatchSchema);
    return ok(
      await getCrmRepository().updateRecord(context, params.objectKey, params.recordId, {
        ...body,
        stageKey: body.stageKey ?? undefined,
        ownerId: body.ownerId ?? undefined
      })
    );
  } catch (error) {
    return handleApiError(error, request);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    await getCrmRepository().deleteRecord(context, params.objectKey, params.recordId);
    return ok({ ok: true });
  } catch (error) {
    return handleApiError(error, request);
  }
}
