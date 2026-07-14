import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, withApiMetrics } from "@/lib/api";
import { getMediaAssetContent } from "@/lib/media/service";

async function getHandler(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    const { asset, bytes } = await getMediaAssetContent(context, params.id);
    const inline = ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(asset.contentType.toLowerCase());
    const disposition = new URL(request.url).searchParams.get("download") === "1" || !inline ? "attachment" : "inline";
    return new Response(bytes, { headers: { "content-type": asset.contentType, "content-length": String(bytes.byteLength), "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(asset.name)}`, "x-content-type-options": "nosniff", "cache-control": "private, max-age=300" } });
  } catch (error) { return handleApiError(error, request); }
}

export const GET = withApiMetrics("GET /api/media-assets/[id]/content", getHandler);
