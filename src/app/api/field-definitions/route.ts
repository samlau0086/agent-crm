
export const dynamic = "force-dynamic";
﻿import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson } from "@/lib/api";
import { fieldDefinitionCreateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

export async function GET(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const objectKey = request.nextUrl.searchParams.get("objectKey") ?? undefined;
    return ok(await getCrmRepository().listFieldDefinitions(context, objectKey));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, fieldDefinitionCreateSchema);
    return ok(await getCrmRepository().createFieldDefinition(context, body), { status: 201 });
  } catch (error) {
    return handleApiError(error, request);
  }
}
