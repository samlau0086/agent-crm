import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, destroyUserSession } from "@/lib/auth/session";


import { withApiMetrics } from "@/lib/api";
export const dynamic = "force-dynamic";
async function postApiMetricsHandler(request: Request) {
  const token = request.headers.get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`))
    ?.split("=")[1];

  if (token) {
    await destroyUserSession(token);
  }
  const response = NextResponse.redirect(new URL("/login", request.url), { status: 303 });
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/"
  });
  return response;
}

export const POST = withApiMetrics("POST /api/auth/logout", postApiMetricsHandler);
