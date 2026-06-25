import type { NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth/rbac";
import { getRequestContext, handleApiError, ok, parseJson } from "@/lib/api";
import { aiTalkTargetSchema, talkMessageCreateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    requirePermission(context, "ai.use");
    const target = parseTalkTargetFromQuery(new URL(request.url).searchParams);
    return ok(await getCrmRepository().listTalkMessages(context, target));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    requirePermission(context, "ai.use");
    const body = await parseJson(request, talkMessageCreateSchema);
    return ok(await getCrmRepository().createTalkMessage(context, { ...body.target, role: body.role, content: body.content, sources: body.sources, knowledgeArticleId: body.knowledgeArticleId }), {
      status: 201
    });
  } catch (error) {
    return handleApiError(error, request);
  }
}

function parseTalkTargetFromQuery(searchParams: URLSearchParams) {
  const type = searchParams.get("type");
  const target =
    type === "record"
      ? {
          type,
          objectKey: searchParams.get("objectKey") ?? "",
          recordId: searchParams.get("recordId") ?? ""
        }
      : {
          type,
          threadId: searchParams.get("threadId") ?? ""
        };
  return aiTalkTargetSchema.parse(target);
}
