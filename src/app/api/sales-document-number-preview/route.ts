export const dynamic = "force-dynamic";
import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, withApiMetrics } from "@/lib/api";
import { assertSalesDocumentObjectKey } from "@/lib/crm/document-numbering";
import { getCrmRepository } from "@/lib/crm/repository";

async function previewNumber(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const objectKey = request.nextUrl.searchParams.get("objectKey") ?? "";
    assertSalesDocumentObjectKey(objectKey);
    return ok(await getCrmRepository().previewSalesDocumentNumber(context, objectKey));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/sales-document-number-preview", previewNumber);
