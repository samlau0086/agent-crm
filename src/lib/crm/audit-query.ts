import type { NextRequest } from "next/server";
import { auditActionSchema } from "@/lib/crm/api-schemas";
import { AUDIT_MAX_PAGE_SIZE, parsePageParam, parsePageSizeParam } from "@/lib/crm/pagination";
import type { AuditLogQuery } from "@/lib/crm/types";

export function parseAuditLogQuery(request: NextRequest): AuditLogQuery {
  const searchParams = request.nextUrl.searchParams;
  const action = auditActionSchema.safeParse(searchParams.get("action"));
  return {
    action: action.success ? action.data : undefined,
    entityType: searchParams.get("entityType")?.trim() || undefined,
    objectKey: searchParams.get("objectKey")?.trim() || undefined,
    actorId: searchParams.get("actorId")?.trim() || undefined,
    q: searchParams.get("q")?.trim() || undefined,
    page: parsePageParam(searchParams.get("page")),
    pageSize: parsePageSizeParam(searchParams.get("pageSize"), AUDIT_MAX_PAGE_SIZE)
  };
}
