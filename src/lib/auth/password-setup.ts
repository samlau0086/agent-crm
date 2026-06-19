import { createHash, randomBytes } from "node:crypto";

export type PasswordSetupPurpose = "invite" | "reset";

export const PASSWORD_SETUP_MAX_AGE_SECONDS = 60 * 60 * 24 * 3;
const PASSWORD_SETUP_TOKEN_BYTES = 32;

export function createPasswordSetupToken(): string {
  return randomBytes(PASSWORD_SETUP_TOKEN_BYTES).toString("base64url");
}

export function hashPasswordSetupToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function normalizePasswordSetupPurpose(value: unknown): PasswordSetupPurpose {
  return value === "invite" ? "invite" : "reset";
}
