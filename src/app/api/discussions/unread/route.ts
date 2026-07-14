import type { NextRequest } from "next/server";
import { z } from "zod";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { getDiscussionUnreadCounts } from "@/lib/discussions/service";
import { parseDiscussionTarget } from "@/lib/discussions/target";

const schema = z.object({ targets: z.array(z.record(z.unknown())).max(100) }).strict();

async function postHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, schema);
    return ok(await getDiscussionUnreadCounts(context, body.targets.map(parseDiscussionTarget)));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const POST = withApiMetrics("POST /api/discussions/unread", postHandler);
