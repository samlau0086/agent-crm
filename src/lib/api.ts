import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { redirect } from "next/navigation";
import type { ZodType } from "zod";
import { getApiErrorAuditCredential, type ApiErrorAuditCredential } from "@/lib/api-audit";
import { ApiError, type ApiErrorCode, type ApiErrorPayload, toApiErrorPayload } from "@/lib/api-error";
import { getBearerToken } from "@/lib/auth/api-key";
import { getSessionUserId, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { getCrmRepository, getRequestContextByApiKeyToken, getRequestContextByUserId } from "@/lib/crm/repository";
import type { RequestContext } from "@/lib/crm/types";
import { parseJsonBody } from "@/lib/api-validation";

export { ApiError } from "@/lib/api-error";

export async function getRequestContext(request: NextRequest): Promise<RequestContext> {
  const userId = request.headers.get("x-user-id");
  if (userId && process.env.ALLOW_TEST_USER_HEADER === "true") {
    return getRequestContextByUserId(userId);
  }

  const bearerToken = getBearerToken(request.headers.get("authorization"));
  if (bearerToken) {
    const context = await getRequestContextByApiKeyToken(bearerToken);
    if (!context) {
      throw new ApiError(401, "AUTH_REQUIRED", "Authentication required");
    }
    return context;
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    throw new ApiError(401, "AUTH_REQUIRED", "Authentication required");
  }

  const sessionUserId = await getSessionUserId(token);
  if (!sessionUserId) {
    throw new ApiError(401, "AUTH_REQUIRED", "Authentication required");
  }

  return getRequestContextByUserId(sessionUserId);
}

export async function requireAppContext(): Promise<RequestContext> {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    redirect("/login");
  }

  const sessionUserId = await getSessionUserId(token);
  if (!sessionUserId) {
    redirect("/login");
  }

  return getRequestContextByUserId(sessionUserId);
}

export async function parseJson<T>(request: Request, schema?: ZodType<T>): Promise<T> {
  return parseJsonBody(request, schema);
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(data, init);
}

export function errorResponse(status: number, code: ApiErrorCode | string, message: string, details?: unknown): NextResponse<ApiErrorPayload> {
  return NextResponse.json(
    {
      error: message,
      code,
      ...(details === undefined ? {} : { details })
    },
    { status }
  );
}

export async function handleApiError(error: unknown, request?: NextRequest | Request): Promise<NextResponse<ApiErrorPayload>> {
  const { status, payload } = toApiErrorPayload(error);
  const url = request ? new URL(request.url) : undefined;
  const method = request?.method;

  console.warn(
    JSON.stringify({
      level: "warn",
      event: "api_error",
      status,
      code: payload.code,
      message: payload.error,
      method,
      path: url?.pathname
    })
  );

  await writeApiErrorAuditLog(request, status, payload).catch(() => undefined);
  return NextResponse.json(payload, { status });
}

async function writeApiErrorAuditLog(request: NextRequest | Request | undefined, status: number, payload: ApiErrorPayload): Promise<void> {
  if (!request || status < 400 || status === 401) {
    return;
  }

  const credential = getApiErrorAuditCredential(request);
  if (!credential) {
    return;
  }

  const context = await getApiErrorAuditContext(credential);
  if (!context) {
    return;
  }

  const url = new URL(request.url);
  await getCrmRepository().writeSystemAuditLog({
    workspaceId: context.workspaceId,
    actorId: context.user.id,
    action: "api_error",
    entityType: "api_request",
    entityId: `${request.method} ${url.pathname}`,
    summary: `${payload.code}: ${payload.error}`,
    details: {
      status,
      code: payload.code,
      method: request.method,
      path: url.pathname,
      query: url.search,
      authType: credential.type,
      details: payload.details
    }
  });
}

async function getApiErrorAuditContext(credential: ApiErrorAuditCredential): Promise<RequestContext | null> {
  if (credential.type === "api_key") {
    return getRequestContextByApiKeyToken(credential.token);
  }

  if (credential.type === "test_user") {
    return getRequestContextByUserId(credential.userId);
  }

  const userId = await getSessionUserId(credential.token);
  return userId ? getRequestContextByUserId(userId) : null;
}
