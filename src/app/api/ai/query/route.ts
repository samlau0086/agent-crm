import type { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { getGlobalAiAgentSetting, aiQueryPlannerAgentKey } from "@/lib/ai/agents";
import { runAiAgent } from "@/lib/ai/harness";
import { buildAiQueryPlan } from "@/lib/ai/query-planner";
import { assertReadOnlyAiQuestion } from "@/lib/ai/query-guard";
import { aiQuerySchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

export const dynamic = "force-dynamic";

const AI_QUERY_MAX_OBJECTS = 4;
const AI_QUERY_PAGE_SIZE = 25;

async function postApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    requirePermission(context, "ai.use");
    const body = await parseJson(request, aiQuerySchema);
    assertReadOnlyAiQuestion(body.question);
    const repository = getCrmRepository();
    const definitions = await repository.listObjectDefinitions(context);
    if (body.objectKey && !definitions.some((object) => object.key === body.objectKey)) {
      throw new Error("Object is not available");
    }
    const allFields = await repository.listFieldDefinitions(context);
    const plan = buildAiQueryPlan({
      question: body.question,
      objectDefinitions: definitions,
      fields: allFields,
      objectKey: body.objectKey,
      maxObjects: AI_QUERY_MAX_OBJECTS,
      pageSize: AI_QUERY_PAGE_SIZE
    });
    const recordPages = await Promise.all(plan.objectKeys.map((objectKey) => repository.queryRecords(context, objectKey, plan.queries[objectKey])));
    const records = recordPages.flatMap((page) => page.records);
    const fields = allFields.filter((field) => plan.objectKeys.includes(field.objectKey));
    const agent = getGlobalAiAgentSetting(await repository.getEmailAiSettings(context), aiQueryPlannerAgentKey);
    if (!agent) {
      throw new Error("AI query planner agent is not available");
    }
    return ok(
      await runAiAgent(
        {
          agentKey: aiQueryPlannerAgentKey,
          task: "Answer the user's read-only CRM question using only supplied candidate records and field definitions.",
          userPrompt: body.question,
          context: {
            question: body.question,
            plan,
            fields: fields.map((field) => ({ key: field.key, label: field.label, type: field.type, objectKey: field.objectKey })),
            records: records.slice(0, 25).map((record) => ({ id: record.id, objectKey: record.objectKey, title: record.title, stageKey: record.stageKey, data: record.data }))
          },
          expectedOutput: "query"
        },
        {
          agent,
          providerConfig: await repository.getEmailAiProviderConfig(context),
          sources: records.slice(0, 5).map((record) => ({ label: record.title, objectKey: record.objectKey, recordId: record.id }))
        }
      )
    );
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const POST = withApiMetrics("POST /api/ai/query", postApiMetricsHandler);
