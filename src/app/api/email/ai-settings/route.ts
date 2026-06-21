import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson } from "@/lib/api";
import { emailAiSettingsUpdateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";


export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    return ok(await getCrmRepository().getEmailAiSettings(context));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, emailAiSettingsUpdateSchema);
    return ok(await getCrmRepository().updateEmailAiSettings(context, body));
  } catch (error) {
    return handleApiError(error, request);
  }
}
