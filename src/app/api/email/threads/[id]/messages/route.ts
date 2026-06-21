import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";


export const dynamic = "force-dynamic";
interface RouteParams {
  params: { id: string };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    return ok(await getCrmRepository().listEmailMessages(context, params.id));
  } catch (error) {
    return handleApiError(error, request);
  }
}
