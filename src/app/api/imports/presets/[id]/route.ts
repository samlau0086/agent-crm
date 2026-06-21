import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson } from "@/lib/api";
import { importPresetUpdateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";


export const dynamic = "force-dynamic";
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, importPresetUpdateSchema);
    return ok(await getCrmRepository().updateImportPreset(context, params.id, body));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    await getCrmRepository().deleteImportPreset(context, params.id);
    return ok({ deleted: true });
  } catch (error) {
    return handleApiError(error, request);
  }
}
