import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson } from "@/lib/api";
import { knowledgeArticleCreateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";


export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const activeOnly = request.nextUrl.searchParams.get("activeOnly") !== "false";
    return ok(await getCrmRepository().listKnowledgeArticles(context, activeOnly));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, knowledgeArticleCreateSchema);
    return ok(await getCrmRepository().createKnowledgeArticle(context, body), { status: 201 });
  } catch (error) {
    return handleApiError(error, request);
  }
}
