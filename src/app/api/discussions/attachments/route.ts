import type { NextRequest } from "next/server";
import { ApiError, getRequestContext, handleApiError, ok, withApiMetrics } from "@/lib/api";
import { uploadDiscussionAttachment } from "@/lib/discussions/service";
import { parseDiscussionTarget } from "@/lib/discussions/target";

export const dynamic = "force-dynamic";

async function postHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "VALIDATION_ERROR", "Attachment file is required");
    const target = parseDiscussionTarget({ type: form.get("type"), objectKey: form.get("objectKey"), targetId: form.get("targetId") });
    return ok(await uploadDiscussionAttachment(context, target, { name: file.name, type: file.type, size: file.size, bytes: new Uint8Array(await file.arrayBuffer()) }), { status: 201 });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const POST = withApiMetrics("POST /api/discussions/attachments", postHandler);
