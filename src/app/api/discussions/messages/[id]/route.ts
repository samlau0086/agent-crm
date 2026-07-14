import type { NextRequest } from "next/server";
import { z } from "zod";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { deleteDiscussionMessage, updateDiscussionMessage } from "@/lib/discussions/service";

const updateSchema = z.object({ body: z.string().max(10_000), mentionUserIds: z.array(z.string().trim().min(1).max(200)).max(100).optional() }).strict();
type RouteParams = { params: { id: string } };

async function patchHandler(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    return ok(await updateDiscussionMessage(context, params.id, await parseJson(request, updateSchema)));
  } catch (error) {
    return handleApiError(error, request);
  }
}

async function deleteHandler(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    await deleteDiscussionMessage(context, params.id);
    return ok({ deleted: true });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const PATCH = withApiMetrics("PATCH /api/discussions/messages/[id]", patchHandler);
export const DELETE = withApiMetrics("DELETE /api/discussions/messages/[id]", deleteHandler);
