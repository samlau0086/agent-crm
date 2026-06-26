import type { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { talkMessageKnowledgePatchSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

export const dynamic = "force-dynamic";

async function patchApiMetricsHandler(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    requirePermission(context, "ai.use");
    const body = await parseJson(request, talkMessageKnowledgePatchSchema);
    return ok(await getCrmRepository().markTalkMessageKnowledgeArticle(context, params.id, body.knowledgeArticleId));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const PATCH = withApiMetrics("PATCH /api/ai/talk/messages/[id]", patchApiMetricsHandler);

async function deleteApiMetricsHandler(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    requirePermission(context, "ai.use");
    await getCrmRepository().deleteTalkMessage(context, params.id);
    return ok({ ok: true });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const DELETE = withApiMetrics("DELETE /api/ai/talk/messages/[id]", deleteApiMetricsHandler);
