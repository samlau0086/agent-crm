import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getRequestContext, handleApiError, ok, withApiMetrics } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";
import { requirePermission } from "@/lib/auth/rbac";
import { appUrl } from "@/lib/security/app-origin";
import { exchangeOAuthAuthorizationCode, verifyEmailOAuthState } from "@/lib/email/oauth";
import { buildOAuthEmailConnectedRedirectUrl, buildOAuthEmailErrorRedirectUrl, connectOAuthEmailAccount } from "@/lib/email/oauth-account";


export const dynamic = "force-dynamic";
async function getApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const error = request.nextUrl.searchParams.get("error");
    if (error) {
      throw new Error(`OAuth provider returned error: ${error}`);
    }
    const code = request.nextUrl.searchParams.get("code");
    const stateText = request.nextUrl.searchParams.get("state");
    if (!code || !stateText) {
      throw new Error("OAuth callback requires code and state");
    }

    const state = verifyEmailOAuthState(stateText);
    if (state.workspaceId !== context.workspaceId || state.userId !== context.user.id) {
      throw new Error("OAuth callback state does not match the current user");
    }
    requirePermission(context, "crm.admin");

    const redirectUri = appUrl("/api/email/oauth/callback", request).toString();
    const connectionConfig = await exchangeOAuthAuthorizationCode({
      provider: state.provider,
      code,
      redirectUri
    });
    const result = await connectOAuthEmailAccount(context, getCrmRepository(), {
      name: state.name,
      emailAddress: state.emailAddress,
      provider: state.provider,
      syncEnabled: state.syncEnabled,
      sendEnabled: state.sendEnabled,
      connectionConfig
    });

    const accept = request.headers.get("accept") ?? "";
    if (accept.includes("text/html") && !accept.includes("application/json")) {
      return NextResponse.redirect(buildOAuthEmailConnectedRedirectUrl(appUrl("/", request), result));
    }

    return ok({ connected: true, created: result.created, account: result.account });
  } catch (error) {
    const accept = request.headers.get("accept") ?? "";
    if (accept.includes("text/html") && !accept.includes("application/json")) {
      return NextResponse.redirect(buildOAuthEmailErrorRedirectUrl(appUrl("/", request), error));
    }
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/email/oauth/callback", getApiMetricsHandler);
