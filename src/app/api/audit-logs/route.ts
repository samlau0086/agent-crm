import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok } from "@/lib/api";
import { parseAuditLogQuery } from "@/lib/crm/audit-query";
import { getCrmRepository } from "@/lib/crm/repository";

export async function GET(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    return ok(await getCrmRepository().listAuditLogs(context, parseAuditLogQuery(request)));
  } catch (error) {
    return handleApiError(error, request);
  }
}
