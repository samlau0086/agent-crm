import { NextResponse, type NextRequest } from "next/server";
import { shouldBlockCrossSiteMutation } from "@/lib/security/csrf";
import { applySecurityHeaders } from "@/lib/security/headers";
import { isWorkflowAutomationApiPath, isWorkflowAutomationEnabled } from "@/lib/workflows/availability";

export function middleware(request: NextRequest) {
  if (!isWorkflowAutomationEnabled() && isWorkflowAutomationApiPath(request.nextUrl.pathname)) {
    const response = NextResponse.json({ error: "Workflow automation is currently unavailable", code: "MODULE_DISABLED" }, { status: 404 });
    applySecurityHeaders(response.headers);
    return response;
  }

  if (
    shouldBlockCrossSiteMutation({
      method: request.method,
      url: request.url,
      origin: request.headers.get("origin"),
      referer: request.headers.get("referer"),
      secFetchSite: request.headers.get("sec-fetch-site")
    })
  ) {
    const response = NextResponse.json({ error: "Cross-site write requests are not allowed", code: "CSRF_BLOCKED" }, { status: 403 });
    applySecurityHeaders(response.headers);
    return response;
  }

  const response = NextResponse.next();
  applySecurityHeaders(response.headers);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
