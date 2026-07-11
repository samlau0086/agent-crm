import type { NextRequest } from "next/server";
import type { z } from "zod";
import { ApiError, getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { currentUserPasswordUpdateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

export const dynamic = "force-dynamic";

async function patchApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const currentSessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!currentSessionToken) {
      throw new ApiError(401, "AUTH_REQUIRED", "Authentication required");
    }
    const body = await parseJson<z.infer<typeof currentUserPasswordUpdateSchema>>(request, currentUserPasswordUpdateSchema);
    const user = await getCrmRepository().updateCurrentUserPassword(
      context,
      {
        currentPassword: body.currentPassword,
        newPassword: body.newPassword
      },
      currentSessionToken
    );
    return ok(user);
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const PATCH = withApiMetrics("PATCH /api/users/me/password", patchApiMetricsHandler);
