import { getBearerToken } from "@/lib/auth/api-key";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";

export type ApiErrorAuditCredential =
  | { type: "api_key"; token: string }
  | { type: "session"; token: string }
  | { type: "test_user"; userId: string };

type AuditRequestLike = {
  headers: Headers;
  cookies?: {
    get?: (name: string) => { value?: string } | undefined;
  };
};

export function getApiErrorAuditCredential(request: AuditRequestLike | undefined): ApiErrorAuditCredential | undefined {
  if (!request) {
    return undefined;
  }

  const bearerToken = getBearerToken(request.headers.get("authorization"));
  if (bearerToken) {
    return { type: "api_key", token: bearerToken };
  }

  const userId = request.headers.get("x-user-id")?.trim();
  if (userId && process.env.ALLOW_TEST_USER_HEADER === "true") {
    return { type: "test_user", userId };
  }

  const sessionToken = request.cookies?.get?.(SESSION_COOKIE_NAME)?.value ?? getCookieValue(request.headers.get("cookie"), SESSION_COOKIE_NAME);
  return sessionToken ? { type: "session", token: sessionToken } : undefined;
}

function getCookieValue(cookieHeader: string | null, name: string): string | undefined {
  return cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
