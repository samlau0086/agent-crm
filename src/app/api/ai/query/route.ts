import type { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac";
import { getRequestContext, handleApiError, ok, parseJson } from "@/lib/api";
import { createAiProvider } from "@/lib/ai/provider";
import { buildAiQueryPlan } from "@/lib/ai/query-planner";
import { assertReadOnlyAiQuestion } from "@/lib/ai/query-guard";
import { aiQuerySchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

const AI_QUERY_MAX_OBJECTS = 4;
const AI_QUERY_PAGE_SIZE = 25;

export async function POST(request: NextRequest) {
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
    const recordPages = await Promise.all(
      plan.objectKeys.map((objectKey) => repository.queryRecords(context, objectKey, plan.queries[objectKey]))
    );
    const records = recordPages.flatMap((page) => page.records);
    const fields = allFields.filter((field) => plan.objectKeys.includes(field.objectKey));
    return ok(await createAiProvider().query({ question: body.question, records, fields }));
  } catch (error) {
    return handleApiError(error, request);
  }
}
