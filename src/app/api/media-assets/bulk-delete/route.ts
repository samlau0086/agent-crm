import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { deleteMediaAssets } from "@/lib/media/service";

async function postHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson<{ ids?: string[] }>(request);
    return ok(await deleteMediaAssets(context, Array.isArray(body.ids) ? body.ids.slice(0, 100) : []));
  } catch (error) { return handleApiError(error, request); }
}
export const POST = withApiMetrics("POST /api/media-assets/bulk-delete", postHandler);
