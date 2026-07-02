import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, withApiMetrics } from "@/lib/api";
import { listAiAgentDefinitions } from "@/lib/ai/agents";
import { getCrmRepository } from "@/lib/crm/repository";

export const dynamic = "force-dynamic";

async function getApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const repository = getCrmRepository();
    return ok({
      definitions: listAiAgentDefinitions(),
      agents: await repository.listAiAgents(context)
    });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/ai/agents", getApiMetricsHandler);
