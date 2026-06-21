import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    return ok(await getCrmRepository().getEmailMessage(context, params.id));
  } catch (error) {
    return handleApiError(error, request);
  }
}
