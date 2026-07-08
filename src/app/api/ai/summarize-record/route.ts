import type { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { getGlobalAiAgentSetting, recordSummaryAgentKey } from "@/lib/ai/agents";
import { runAiAgent } from "@/lib/ai/harness";
import { aiRecordRequestSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

export const dynamic = "force-dynamic";

async function postApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    requirePermission(context, "ai.use");
    const body = await parseJson(request, aiRecordRequestSchema);
    const repository = getCrmRepository();
    const record = await repository.getRecord(context, body.objectKey, body.recordId);
    const fields = await repository.listFieldDefinitions(context, body.objectKey);
    const activities = await repository.listActivities(context, body.recordId);
    const agent = getGlobalAiAgentSetting(await repository.getEmailAiSettings(context), recordSummaryAgentKey);
    if (!agent) {
      throw new Error("Record summary agent is not available");
    }
    return ok(
      await runAiAgent(
        {
          agentKey: recordSummaryAgentKey,
          task: "用简体中文为销售用户总结这条 CRM 记录。保持只读、基于来源，不要编造事实。",
          context: {
            record: { id: record.id, objectKey: record.objectKey, title: record.title, stageKey: record.stageKey, ownerId: record.ownerId, data: record.data },
            fields: fields.map((field) => ({ key: field.key, label: field.label, type: field.type })),
            activities: activities.slice(0, 10)
          },
          expectedOutput: "text"
        },
        {
          agent,
          providerConfig: await repository.getAiProviderConfigForAgent(context, agent),
          sources: [{ label: record.title, objectKey: record.objectKey, recordId: record.id }, ...activities.slice(0, 3).map((activity) => ({ label: activity.title, activityId: activity.id }))]
        }
      )
    );
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const POST = withApiMetrics("POST /api/ai/summarize-record", postApiMetricsHandler);
