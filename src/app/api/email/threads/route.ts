import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, withApiMetrics } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";


export const dynamic = "force-dynamic";
async function getEmailThreads(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const recordId = request.nextUrl.searchParams.get("recordId") ?? undefined;
    return ok(await getCrmRepository().listEmailThreads(context, recordId));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/email/threads", getEmailThreads);
