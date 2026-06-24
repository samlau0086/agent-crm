import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson } from "@/lib/api";
import { emailSyncSettingsUpdateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    return ok(await getCrmRepository().getEmailSyncSettings(context));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, emailSyncSettingsUpdateSchema);
    return ok(await getCrmRepository().updateEmailSyncSettings(context, body));
  } catch (error) {
    return handleApiError(error, request);
  }
}
