import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson } from "@/lib/api";
import { emailConnectionTestSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";
import { createEmailProviderAdapter } from "@/lib/email/provider";


export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, emailConnectionTestSchema);
    const repository = getCrmRepository();
    const adapter = createEmailProviderAdapter(repository);
    return ok(await adapter.testConnection(context, body.accountId, { scope: body.scope, outboundServiceId: body.outboundServiceId }));
  } catch (error) {
    return handleApiError(error, request);
  }
}
