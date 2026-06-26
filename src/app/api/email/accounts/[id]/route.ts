import type { NextRequest } from "next/server";
import { emailAccountUpdateSchema } from "@/lib/crm/api-schemas";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";

export const dynamic = "force-dynamic";

async function getApiMetricsHandler(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    return ok(await getCrmRepository().getEmailAccount(context, params.id));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/email/accounts/[id]", getApiMetricsHandler);

async function patchApiMetricsHandler(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, emailAccountUpdateSchema);
    return ok(await getCrmRepository().updateEmailAccount(context, params.id, body));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const PATCH = withApiMetrics("PATCH /api/email/accounts/[id]", patchApiMetricsHandler);

async function deleteApiMetricsHandler(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    await getCrmRepository().deleteEmailAccount(context, params.id);
    return ok({ ok: true });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const DELETE = withApiMetrics("DELETE /api/email/accounts/[id]", deleteApiMetricsHandler);
