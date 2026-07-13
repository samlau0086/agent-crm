import type { NextRequest } from "next/server";
import { emailThreadStateUpdateSchema } from "@/lib/crm/api-schemas";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";
import { createEmailProviderAdapter } from "@/lib/email/provider";

export const dynamic = "force-dynamic";

async function patchApiMetricsHandler(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, emailThreadStateUpdateSchema);
    const repository = getCrmRepository();
    if (typeof body.deleted === "boolean") {
      const remoteHandled = await createEmailProviderAdapter(repository).syncThreadDeletion(context, params.id, body.deleted);
      if (!remoteHandled) {
        return ok(await repository.updateEmailThreadState(context, params.id, body));
      }
      const { deleted: _deleted, ...remaining } = body;
      if (Object.keys(remaining).length) {
        await repository.updateEmailThreadState(context, params.id, remaining);
      }
      return ok(await repository.getEmailThread(context, params.id));
    }
    return ok(await repository.updateEmailThreadState(context, params.id, body));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const PATCH = withApiMetrics("PATCH /api/email/threads/[id]/state", patchApiMetricsHandler);
