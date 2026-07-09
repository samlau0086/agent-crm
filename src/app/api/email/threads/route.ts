import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, withApiMetrics } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";
import { parseEmailThreadSearchCommand } from "@/lib/email/search-command";


export const dynamic = "force-dynamic";
async function getEmailThreads(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const recordId = request.nextUrl.searchParams.get("recordId") ?? undefined;
    const command = parseEmailThreadSearchCommand(request.nextUrl.searchParams.get("mailSearch") ?? "");
    return ok(await getCrmRepository().listEmailThreads(context, { recordId, command }));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/email/threads", getEmailThreads);
