import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { deleteMediaAssets, updateMediaAsset } from "@/lib/media/service";
import { getCrmRepository } from "@/lib/crm/repository";
import { mediaAssetUpdateSchema } from "@/lib/crm/api-schemas";

async function patchHandler(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    const raw = await request.clone().json().catch(() => ({})) as Record<string, unknown>;
    const body = "archived" in raw || "promoteToWorkspace" in raw
      ? await parseJson<{ name?: string; archived?: boolean; promoteToWorkspace?: boolean }>(request)
      : await parseJson(request, mediaAssetUpdateSchema);
    if ("contentBase64" in body && body.contentBase64) return ok(await getCrmRepository().updateMediaAsset(context, params.id, body));
    return ok(await updateMediaAsset(context, params.id, body));
  } catch (error) { return handleApiError(error, request); }
}

async function deleteHandler(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    return ok(await deleteMediaAssets(context, [params.id]));
  } catch (error) { return handleApiError(error, request); }
}

export const PATCH = withApiMetrics("PATCH /api/media-assets/[id]", patchHandler);
export const DELETE = withApiMetrics("DELETE /api/media-assets/[id]", deleteHandler);
