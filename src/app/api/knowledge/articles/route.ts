import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { knowledgeArticleCreateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";


export const dynamic = "force-dynamic";
async function getApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const activeOnly = request.nextUrl.searchParams.get("activeOnly") !== "false";
    return ok(await getCrmRepository().listKnowledgeArticles(context, activeOnly));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/knowledge/articles", getApiMetricsHandler);

async function postApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, knowledgeArticleCreateSchema);
    return ok(await getCrmRepository().createKnowledgeArticle(context, body), { status: 201 });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const POST = withApiMetrics("POST /api/knowledge/articles", postApiMetricsHandler);
