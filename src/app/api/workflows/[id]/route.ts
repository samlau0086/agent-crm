import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { workflowUpdateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";
import type { WorkflowDefinition } from "@/lib/crm/types";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: { id: string };
}

async function getHandler(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    return ok(await getCrmRepository().getWorkflow(context, params.id));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/workflows/[id]", getHandler);

async function patchHandler(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, workflowUpdateSchema);
    return ok(await getCrmRepository().updateWorkflow(context, params.id, body as Partial<Omit<WorkflowDefinition, "id" | "workspaceId" | "createdById" | "createdAt" | "updatedAt" | "lastRunAt">>));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const PATCH = withApiMetrics("PATCH /api/workflows/[id]", patchHandler);

async function deleteHandler(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    await getCrmRepository().deleteWorkflow(context, params.id);
    return ok({ ok: true });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const DELETE = withApiMetrics("DELETE /api/workflows/[id]", deleteHandler);
