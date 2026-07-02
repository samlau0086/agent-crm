import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { aiAgentTestSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

export const dynamic = "force-dynamic";

type RouteParams = { params: { agentKey: string } };

async function postApiMetricsHandler(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, aiAgentTestSchema);
    return ok(await getCrmRepository().testAiAgent(context, params.agentKey, body));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const POST = withApiMetrics("POST /api/ai/agents/[agentKey]/test", postApiMetricsHandler);
