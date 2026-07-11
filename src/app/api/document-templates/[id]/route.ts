import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { documentTemplateUpdateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: { id: string };
}

async function getTemplate(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    return ok(await getCrmRepository().getDocumentTemplate(context, params.id));
  } catch (error) {
    return handleApiError(error, request);
  }
}

async function updateTemplate(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, documentTemplateUpdateSchema);
    return ok(await getCrmRepository().updateDocumentTemplate(context, params.id, body));
  } catch (error) {
    return handleApiError(error, request);
  }
}

async function deleteTemplate(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    await getCrmRepository().deleteDocumentTemplate(context, params.id);
    return ok({ ok: true });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/document-templates/[id]", getTemplate);
export const PATCH = withApiMetrics("PATCH /api/document-templates/[id]", updateTemplate);
export const DELETE = withApiMetrics("DELETE /api/document-templates/[id]", deleteTemplate);
