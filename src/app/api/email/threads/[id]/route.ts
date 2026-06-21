import type { NextRequest } from "next/server";
import { emailThreadUpdateSchema } from "@/lib/crm/api-schemas";
import { getRequestContext, handleApiError, ok, parseJson } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    return ok(await getCrmRepository().getEmailThread(context, params.id));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, emailThreadUpdateSchema);
    return ok(await getCrmRepository().updateEmailThread(context, params.id, body));
  } catch (error) {
    return handleApiError(error, request);
  }
}
