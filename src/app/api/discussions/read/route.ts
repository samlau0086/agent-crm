import type { NextRequest } from "next/server";
import { z } from "zod";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { markDiscussionRead } from "@/lib/discussions/service";
import { parseDiscussionTarget } from "@/lib/discussions/target";

const schema = z.object({ target: z.record(z.unknown()) }).strict();

async function postHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, schema);
    await markDiscussionRead(context, parseDiscussionTarget(body.target));
    return ok({ read: true });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const POST = withApiMetrics("POST /api/discussions/read", postHandler);
