import { createHash, randomBytes } from "node:crypto";

const API_KEY_BYTES = 32;
const API_KEY_PREFIX = "crm_live";
const API_KEY_VISIBLE_PREFIX_LENGTH = 18;

export function createApiKeyToken(): string {
  return `${API_KEY_PREFIX}_${randomBytes(API_KEY_BYTES).toString("base64url")}`;
}

export function hashApiKeyToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function getApiKeyTokenPrefix(token: string): string {
  return token.slice(0, API_KEY_VISIBLE_PREFIX_LENGTH);
}

export function getBearerToken(value: string | null): string | undefined {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}
