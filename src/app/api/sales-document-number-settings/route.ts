export const dynamic = "force-dynamic";
import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { salesDocumentNumberSettingsUpdateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

async function getSettings(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    return ok(await getCrmRepository().getSalesDocumentNumberSettings(context));
  } catch (error) {
    return handleApiError(error, request);
  }
}

async function updateSettings(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, salesDocumentNumberSettingsUpdateSchema);
    return ok(await getCrmRepository().updateSalesDocumentNumberSettings(context, body.settings));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/sales-document-number-settings", getSettings);
export const PATCH = withApiMetrics("PATCH /api/sales-document-number-settings", updateSettings);
