import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { emailSignatureCreateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

export const dynamic = "force-dynamic";

async function getApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    return ok(await getCrmRepository().listEmailSignatures(context));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/email/signatures", getApiMetricsHandler);

async function postApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, emailSignatureCreateSchema);
    return ok(await getCrmRepository().createEmailSignature(context, body), { status: 201 });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const POST = withApiMetrics("POST /api/email/signatures", postApiMetricsHandler);
