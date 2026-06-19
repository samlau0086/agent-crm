import type { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac";
import { getRequestContext, handleApiError, ok, parseJson } from "@/lib/api";
import { createAiProvider } from "@/lib/ai/provider";
import { aiRecordRequestSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

export async function POST(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    requirePermission(context, "ai.use");
    const body = await parseJson(request, aiRecordRequestSchema);
    const repository = getCrmRepository();
    const record = await repository.getRecord(context, body.objectKey, body.recordId);
    const activities = await repository.listActivities(context, body.recordId);
    return ok(await createAiProvider().suggestNextActions({ record, activities }));
  } catch (error) {
    return handleApiError(error, request);
  }
}
