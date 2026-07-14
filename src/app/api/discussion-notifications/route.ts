import type { NextRequest } from "next/server";
import { z } from "zod";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { listDiscussionNotifications, markDiscussionNotificationsRead } from "@/lib/discussions/service";

const updateSchema = z.object({ ids: z.array(z.string().trim().min(1).max(200)).max(100).optional() }).strict();

async function getHandler(request: NextRequest) {
  try {
    return ok(await listDiscussionNotifications(await getRequestContext(request)));
  } catch (error) {
    return handleApiError(error, request);
  }
}

async function patchHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, updateSchema);
    await markDiscussionNotificationsRead(context, body.ids);
    return ok({ read: true });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/discussion-notifications", getHandler);
export const PATCH = withApiMetrics("PATCH /api/discussion-notifications", patchHandler);
