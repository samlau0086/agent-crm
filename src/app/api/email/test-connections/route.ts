import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";
import { testEmailAccountConnections } from "@/lib/email/connection-tests";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const repository = getCrmRepository();
    return ok(await testEmailAccountConnections(context, repository));
  } catch (error) {
    return handleApiError(error, request);
  }
}
