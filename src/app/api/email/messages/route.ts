import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson } from "@/lib/api";
import { emailMessageCreateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";


export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, emailMessageCreateSchema);
    return ok(await getCrmRepository().recordEmailMessage(context, body), { status: 201 });
  } catch (error) {
    return handleApiError(error, request);
  }
}
