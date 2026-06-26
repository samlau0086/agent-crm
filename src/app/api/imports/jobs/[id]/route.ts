import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { importJobActionSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";
import { getBackgroundJobExecutor } from "@/lib/jobs/executor";


export const dynamic = "force-dynamic";
async function getApiMetricsHandler(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    return ok(await getCrmRepository().getImportJob(context, params.id));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/imports/jobs/[id]", getApiMetricsHandler);

async function patchApiMetricsHandler(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, importJobActionSchema);
    const repository = getCrmRepository();

    if (body.action === "cancel") {
      return ok(await repository.cancelCsvImportJob(context, params.id));
    }

    const copied =
      body.action === "retry"
        ? await repository.createRetryCsvImportJob(context, params.id)
        : await repository.createRerunCsvImportJob(context, params.id);

    return ok(await getBackgroundJobExecutor(repository).runCsvImportJob(context, copied.job.id, copied.payload), { status: 201 });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const PATCH = withApiMetrics("PATCH /api/imports/jobs/[id]", patchApiMetricsHandler);
