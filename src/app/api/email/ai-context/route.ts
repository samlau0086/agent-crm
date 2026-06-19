import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson } from "@/lib/api";
import { emailAssistantContextSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

export async function POST(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, emailAssistantContextSchema);
    return ok(await getCrmRepository().buildEmailAssistantContext(context, body));
  } catch (error) {
    return handleApiError(error, request);
  }
}
