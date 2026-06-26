import type { NextRequest } from "next/server";
import type { z } from "zod";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { emailSignatureUpdateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: { id: string };
}

async function patchApiMetricsHandler(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson<z.infer<typeof emailSignatureUpdateSchema>>(request, emailSignatureUpdateSchema);
    return ok(await getCrmRepository().updateEmailSignature(context, params.id, body));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const PATCH = withApiMetrics("PATCH /api/email/signatures/[id]", patchApiMetricsHandler);

async function deleteApiMetricsHandler(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    await getCrmRepository().deleteEmailSignature(context, params.id);
    return ok({ deleted: true });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const DELETE = withApiMetrics("DELETE /api/email/signatures/[id]", deleteApiMetricsHandler);
