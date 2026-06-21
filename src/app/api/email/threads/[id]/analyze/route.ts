import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";
import { getBackgroundJobExecutor } from "@/lib/jobs/executor";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: { id: string };
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    const repository = getCrmRepository();
    return ok(await getBackgroundJobExecutor(repository).runEmailAnalyzeJob(context, { threadId: params.id }));
  } catch (error) {
    return handleApiError(error, request);
  }
}
