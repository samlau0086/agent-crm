import { NextResponse } from "next/server";
import { clearFailedLogin, getLoginClientIp, isLoginRateLimited, recordFailedLogin } from "@/lib/auth/login-rate-limit";
import { createUserSession, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { errorResponse } from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import { parseFormBody } from "@/lib/api-validation";
import { prisma } from "@/lib/db";
import { appUrl, getAppBaseUrl } from "@/lib/security/app-origin";

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await parseFormBody(request);
  } catch (error) {
    if (error instanceof ApiError) {
      return errorResponse(error.status, error.code, error.message, error.details);
    }
    return errorResponse(400, "BAD_REQUEST", "Request body must be form data");
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const origin = getAppBaseUrl(request);
  const loginIdentity = { email, ip: getLoginClientIp(request) };
  const rateLimit = isLoginRateLimited(loginIdentity);
  if (rateLimit.limited) {
    return loginRateLimitResponse(request, origin, rateLimit.retryAfterSeconds);
  }

  const user = await prisma.user.findFirst({
    where: { email, active: true },
    select: { id: true, passwordHash: true }
  });

  if (!user || !verifyPassword(password, user.passwordHash)) {
    recordFailedLogin(loginIdentity);
    return NextResponse.redirect(appUrl("/login?error=invalid", request), { status: 303 });
  }

  clearFailedLogin(loginIdentity);
  const token = await createUserSession(user.id);
  const response = NextResponse.redirect(appUrl("/", request), { status: 303 });
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/"
  });
  return response;
}

function loginRateLimitResponse(request: Request, origin: string, retryAfterSeconds = 60) {
  if (request.headers.get("accept")?.includes("text/html")) {
    return NextResponse.redirect(new URL("/login?error=rate_limited", origin), { status: 303 });
  }

  return NextResponse.json(
    {
      error: "Too many failed login attempts. Try again later.",
      code: "RATE_LIMITED"
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds)
      }
    }
  );
}
