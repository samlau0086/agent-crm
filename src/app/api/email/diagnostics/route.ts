import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";
import { checkEmailSubsystemDiagnosticsForContext } from "@/lib/email/diagnostics";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    return ok(await checkEmailSubsystemDiagnosticsForContext(context, getCrmRepository(), { includeJobs: true }));
  } catch (error) {
    return handleApiError(error, request);
  }
}
