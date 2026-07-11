import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { documentTemplateCreateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

export const dynamic = "force-dynamic";

async function listTemplates(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const objectKey = request.nextUrl.searchParams.get("objectKey") ?? undefined;
    return ok(await getCrmRepository().listDocumentTemplates(context, objectKey));
  } catch (error) {
    return handleApiError(error, request);
  }
}

async function createTemplate(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, documentTemplateCreateSchema);
    return ok(
      await getCrmRepository().createDocumentTemplate(context, {
        ...body,
        active: body.active ?? true,
        isDefault: body.isDefault ?? false
      }),
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/document-templates", listTemplates);
export const POST = withApiMetrics("POST /api/document-templates", createTemplate);
