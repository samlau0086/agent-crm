import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson } from "@/lib/api";
import { emailSignatureCreateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    return ok(await getCrmRepository().listEmailSignatures(context));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, emailSignatureCreateSchema);
    return ok(await getCrmRepository().createEmailSignature(context, body), { status: 201 });
  } catch (error) {
    return handleApiError(error, request);
  }
}
