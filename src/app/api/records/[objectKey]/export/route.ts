import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, withApiMetrics } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";
import { parseRecordListQuery } from "@/lib/crm/record-query";


export const dynamic = "force-dynamic";
async function getApiMetricsHandler(request: NextRequest, { params }: { params: { objectKey: string } }) {
  try {
    const context = await getRequestContext(request);
    const csv = await getCrmRepository().exportRecordsCsv(context, params.objectKey, parseRecordListQuery(request));
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${params.objectKey}-export.csv"`
      }
    });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/records/[objectKey]/export", getApiMetricsHandler);
