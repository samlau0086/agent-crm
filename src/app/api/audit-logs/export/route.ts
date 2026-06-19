import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError } from "@/lib/api";
import { parseAuditLogQuery } from "@/lib/crm/audit-query";
import { getCrmRepository } from "@/lib/crm/repository";

export async function GET(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const csv = await getCrmRepository().exportAuditLogsCsv(context, parseAuditLogQuery(request));
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="audit-logs-export.csv"'
      }
    });
  } catch (error) {
    return handleApiError(error, request);
  }
}
