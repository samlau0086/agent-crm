import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseOptionalJson, withApiMetrics } from "@/lib/api";
import { emailMessageTranslateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";
import { getBackgroundJobExecutor } from "@/lib/jobs/executor";


export const dynamic = "force-dynamic";

async function postApiMetricsHandler(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    const body = await parseOptionalJson(request, emailMessageTranslateSchema, {});
    const repository = getCrmRepository();
    const executor = getBackgroundJobExecutor(repository);
    return ok(await executor.runEmailTranslateJob(context, { messageId: params.id, targetLocale: body.targetLocale }));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const POST = withApiMetrics("POST /api/email/messages/[id]/translate", postApiMetricsHandler);
