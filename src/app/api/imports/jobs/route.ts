import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { csvImportSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";
import { getBackgroundJobExecutor } from "@/lib/jobs/executor";


export const dynamic = "force-dynamic";
async function getApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const objectKey = request.nextUrl.searchParams.get("objectKey")?.trim() || undefined;
    return ok(await getCrmRepository().listImportJobs(context, objectKey));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/imports/jobs", getApiMetricsHandler);

async function postApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, csvImportSchema);
    const repository = getCrmRepository();
    const job = await repository.createQueuedCsvImportJob(context, body);
    return ok(await getBackgroundJobExecutor(repository).runCsvImportJob(context, job.id, body), { status: 201 });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const POST = withApiMetrics("POST /api/imports/jobs", postApiMetricsHandler);
