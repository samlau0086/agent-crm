import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { emailOAuthStartSchema } from "@/lib/crm/api-schemas";
import { requirePermission } from "@/lib/auth/rbac";
import { appUrl } from "@/lib/security/app-origin";
import { buildOAuthAuthorizationUrl, createEmailOAuthState } from "@/lib/email/oauth";


export const dynamic = "force-dynamic";
async function postApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    requirePermission(context, "crm.admin");
    const body = await parseJson(request, emailOAuthStartSchema);
    const redirectUri = appUrl("/api/email/oauth/callback", request).toString();
    const state = createEmailOAuthState({
      provider: body.provider,
      workspaceId: context.workspaceId,
      userId: context.user.id,
      emailAddress: body.emailAddress,
      name: body.name ?? `${body.provider} mailbox`,
      syncEnabled: body.syncEnabled ?? true,
      sendEnabled: body.sendEnabled ?? true
    });

    return ok({
      provider: body.provider,
      redirectUri,
      state,
      authorizationUrl: buildOAuthAuthorizationUrl({ provider: body.provider, redirectUri, state })
    });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const POST = withApiMetrics("POST /api/email/oauth/start", postApiMetricsHandler);
