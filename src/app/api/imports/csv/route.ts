
export const dynamic = "force-dynamic";
﻿import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { csvImportSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

async function postApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, csvImportSchema);
    const strategy = body.strategy ?? "skip-invalid";
    return ok(await getCrmRepository().importCsv(context, body.objectKey, body.csv, strategy, body.mapping), { status: 201 });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const POST = withApiMetrics("POST /api/imports/csv", postApiMetricsHandler);
