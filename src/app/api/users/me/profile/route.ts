import type { NextRequest } from "next/server";
import type { z } from "zod";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { currentUserProfileUpdateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

export const dynamic = "force-dynamic";

async function patchApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson<z.infer<typeof currentUserProfileUpdateSchema>>(request, currentUserProfileUpdateSchema);
    return ok(await getCrmRepository().updateCurrentUserProfile(context, body));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const PATCH = withApiMetrics("PATCH /api/users/me/profile", patchApiMetricsHandler);
