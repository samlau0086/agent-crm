import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { workflowCreateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";
import type { WorkflowDefinition } from "@/lib/crm/types";

export const dynamic = "force-dynamic";

async function getHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    return ok(await getCrmRepository().listWorkflows(context));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/workflows", getHandler);

async function postHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, workflowCreateSchema);
    return ok(await getCrmRepository().createWorkflow(context, body as Omit<WorkflowDefinition, "id" | "workspaceId" | "createdById" | "createdAt" | "updatedAt" | "version" | "lastRunAt" | "status"> & Partial<Pick<WorkflowDefinition, "version" | "status">>), { status: 201 });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const POST = withApiMetrics("POST /api/workflows", postHandler);
