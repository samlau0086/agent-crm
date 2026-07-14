import type { NextRequest } from "next/server";
import { z } from "zod";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { createDiscussionMessage, listDiscussionMessages } from "@/lib/discussions/service";
import { parseDiscussionTarget } from "@/lib/discussions/target";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  target: z.record(z.unknown()),
  body: z.string().max(10_000).optional(),
  replyToId: z.string().trim().min(1).max(200).optional(),
  attachmentIds: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
  mentionUserIds: z.array(z.string().trim().min(1).max(200)).max(100).optional()
}).strict();

async function getHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const params = request.nextUrl.searchParams;
    const target = parseDiscussionTarget({ type: params.get("type"), objectKey: params.get("objectKey"), targetId: params.get("targetId") });
    return ok(await listDiscussionMessages(context, target, { before: params.get("before") ?? undefined, after: params.get("after") ?? undefined, limit: params.get("limit") ? Number(params.get("limit")) : undefined }));
  } catch (error) {
    return handleApiError(error, request);
  }
}

async function postHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, createSchema);
    return ok(await createDiscussionMessage(context, parseDiscussionTarget(body.target), body), { status: 201 });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/discussions/messages", getHandler);
export const POST = withApiMetrics("POST /api/discussions/messages", postHandler);
