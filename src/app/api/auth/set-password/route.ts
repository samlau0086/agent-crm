import { NextResponse } from "next/server";
import { z } from "zod";
import { hashPassword } from "@/lib/auth/password";
import { hashPasswordSetupToken } from "@/lib/auth/password-setup";
import { errorResponse } from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import { parseFormBody, parseJsonBody } from "@/lib/api-validation";
import { prisma } from "@/lib/db";
import { appUrl, getAppBaseUrl } from "@/lib/security/app-origin";

const setPasswordJsonSchema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(1),
    passwordConfirm: z.string().optional()
  })
  .strict();

export async function POST(request: Request) {
  const origin = getAppBaseUrl(request);
  let input: Awaited<ReturnType<typeof parsePasswordInput>>;
  try {
    input = await parsePasswordInput(request);
  } catch (error) {
    if (error instanceof ApiError) {
      return errorResponse(error.status, error.code, error.message, error.details);
    }
    return errorResponse(400, "BAD_REQUEST", "Request failed");
  }
  const isForm = input.kind === "form";

  if (!input.token || !input.password || input.password.length < 8) {
    return passwordResponse({ origin, token: input.token, isForm, error: "weak", status: 400, code: "WEAK_PASSWORD" });
  }
  if (input.passwordConfirm !== undefined && input.password !== input.passwordConfirm) {
    return passwordResponse({ origin, token: input.token, isForm, error: "mismatch", status: 400, code: "PASSWORD_MISMATCH" });
  }

  const now = new Date();
  const setupToken = await prisma.passwordSetupToken.findUnique({
    where: { tokenHash: hashPasswordSetupToken(input.token) },
    include: { user: true }
  });

  if (!setupToken || setupToken.usedAt || setupToken.expiresAt <= now || !setupToken.user.active) {
    return passwordResponse({ origin, token: input.token, isForm, error: "invalid", status: 400, code: "INVALID_PASSWORD_SETUP_TOKEN" });
  }

  try {
    await prisma.$transaction(async (tx) => {
      const consumed = await tx.passwordSetupToken.updateMany({
        where: {
          id: setupToken.id,
          usedAt: null,
          expiresAt: { gt: now }
        },
        data: { usedAt: now }
      });
      if (consumed.count !== 1) {
        throw new Error("Password setup link has already been used");
      }

      await tx.user.update({
        where: { id: setupToken.userId },
        data: { passwordHash: hashPassword(input.password) }
      });
      await tx.session.deleteMany({ where: { userId: setupToken.userId } });
    });
  } catch {
    return passwordResponse({ origin, token: input.token, isForm, error: "invalid", status: 400, code: "INVALID_PASSWORD_SETUP_TOKEN" });
  }

  if (!isForm) {
    return NextResponse.json({ ok: true });
  }
  return NextResponse.redirect(appUrl("/login?password=updated", request), { status: 303 });
}

async function parsePasswordInput(request: Request): Promise<{
  kind: "form" | "json";
  token: string;
  password: string;
  passwordConfirm?: string;
}> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const data = await parseJsonBody(request, setPasswordJsonSchema);
    return {
      kind: "json",
      token: data.token,
      password: data.password,
      passwordConfirm: data.passwordConfirm
    };
  }

  const formData = await parseFormBody(request);
  return {
    kind: "form",
    token: String(formData.get("token") ?? ""),
    password: String(formData.get("password") ?? ""),
    passwordConfirm: String(formData.get("passwordConfirm") ?? "")
  };
}

function passwordResponse(input: {
  origin: string;
  token: string;
  isForm: boolean;
  error: "invalid" | "weak" | "mismatch";
  status: number;
  code: string;
}) {
  if (!input.isForm) {
    return errorResponse(input.status, input.code, passwordErrorMessage(input.error));
  }

  const url = new URL("/setup-password", input.origin);
  if (input.token && input.error !== "invalid") {
    url.searchParams.set("token", input.token);
  }
  url.searchParams.set("error", input.error);
  return NextResponse.redirect(url, { status: 303 });
}

function passwordErrorMessage(error: "invalid" | "weak" | "mismatch"): string {
  if (error === "weak") return "Password must be at least 8 characters";
  if (error === "mismatch") return "Passwords do not match";
  return "Password setup link is invalid or expired";
}
