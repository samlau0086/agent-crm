import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson } from "@/lib/api";
import { importPresetCreateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";


export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const objectKey = request.nextUrl.searchParams.get("objectKey")?.trim() || undefined;
    return ok(await getCrmRepository().listImportPresets(context, objectKey));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, importPresetCreateSchema);
    return ok(await getCrmRepository().createImportPreset(context, body), { status: 201 });
  } catch (error) {
    return handleApiError(error, request);
  }
}
