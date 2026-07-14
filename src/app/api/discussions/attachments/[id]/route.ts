import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, withApiMetrics } from "@/lib/api";
import { getDiscussionAttachment } from "@/lib/discussions/service";
import { getDiscussionObject, isInlineDiscussionImage } from "@/lib/discussions/storage";
import { getMediaObject } from "@/lib/media/storage";

async function getHandler(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    const attachment = await getDiscussionAttachment(context, params.id);
    const bytes = attachment.mediaAsset?.storageKey ? await getMediaObject(attachment.mediaAsset.storageKey) : await getDiscussionObject(attachment.storageKey);
    const fallbackName = attachment.fileName.replace(/["\r\n\\]/g, "_");
    const disposition = isInlineDiscussionImage(attachment.contentType) ? "inline" : "attachment";
    return new Response(bytes, {
      headers: {
        "content-type": attachment.contentType,
        "content-length": String(bytes.byteLength),
        "content-disposition": `${disposition}; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff"
      }
    });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/discussions/attachments/[id]", getHandler);
