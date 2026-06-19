import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";

export async function GET(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const recordId = request.nextUrl.searchParams.get("recordId") ?? undefined;
    return ok(await getCrmRepository().listEmailThreads(context, recordId));
  } catch (error) {
    return handleApiError(error, request);
  }
}
