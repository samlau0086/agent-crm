import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, withApiMetrics } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";


export const dynamic = "force-dynamic";
async function getApiMetricsHandler(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    const csv = await getCrmRepository().exportImportJobIssuesCsv(context, params.id);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="import-${params.id}-issues.csv"`
      }
    });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/imports/jobs/[id]/issues", getApiMetricsHandler);
