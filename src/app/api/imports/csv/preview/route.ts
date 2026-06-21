
export const dynamic = "force-dynamic";
﻿import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson } from "@/lib/api";
import { csvPreviewSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

export async function POST(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, csvPreviewSchema);
    return ok(await getCrmRepository().previewCsvImport(context, body.objectKey, body.csv, body.mapping));
  } catch (error) {
    return handleApiError(error, request);
  }
}
