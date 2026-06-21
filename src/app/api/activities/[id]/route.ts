import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson } from "@/lib/api";
import { activityUpdateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: { id: string };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    return ok(await getCrmRepository().getActivity(context, params.id));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, activityUpdateSchema);
    return ok(await getCrmRepository().updateActivity(context, params.id, body));
  } catch (error) {
    return handleApiError(error, request);
  }
}
