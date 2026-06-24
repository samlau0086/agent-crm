import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { AiProviderConfig, AiProviderType } from "@/lib/crm/types";

const CIPHER = "aes-256-gcm";
const VERSION = "v1";
const DEFAULT_TIMEOUT_MS = 10000;

const providerDefaults: Record<AiProviderType, { baseUrl: string; model: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-1.5-flash" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4.1-mini" },
  custom: { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini" },
  "openai-compatible": { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini" }
};

export function normalizeAiProviderType(provider: unknown): AiProviderType {
  if (provider === "openai" || provider === "gemini" || provider === "openrouter" || provider === "custom" || provider === "openai-compatible") {
    return provider;
  }
  return "openai";
}

export function normalizeAiProviderConfig(config: Partial<AiProviderConfig> | undefined): AiProviderConfig {
  const provider = normalizeAiProviderType(config?.provider ?? process.env.AI_PROVIDER);
  const defaults = providerDefaults[provider];
  return {
    provider,
    baseUrl: config?.baseUrl?.trim() || process.env.AI_BASE_URL?.trim() || defaults.baseUrl,
    apiKey: config?.apiKey ?? process.env.AI_API_KEY ?? "",
    model: config?.model?.trim() || process.env.AI_MODEL?.trim() || defaults.model,
    timeoutMs: normalizeTimeout(config?.timeoutMs ?? Number(process.env.AI_TIMEOUT_MS))
  };
}

export function publicAiProviderConfig(config: Partial<AiProviderConfig> | undefined): AiProviderConfig {
  const normalized = normalizeAiProviderConfig(config);
  return {
    ...normalized,
    apiKey: undefined,
    hasApiKey: Boolean(normalized.apiKey)
  };
}

export function encryptAiProviderConfig(config: Partial<AiProviderConfig>, secret = process.env.EMAIL_CONFIG_SECRET ?? process.env.APP_SECRET ?? ""): string {
  const normalized = normalizeAiProviderConfig(config);
  const key = deriveKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER, key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(normalized), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptAiProviderConfig(value: string, secret = process.env.EMAIL_CONFIG_SECRET ?? process.env.APP_SECRET ?? ""): AiProviderConfig {
  const [version, ivText, tagText, ciphertextText] = value.split(".");
  if (version !== VERSION || !ivText || !tagText || !ciphertextText) {
    throw new Error("AI provider config is invalid");
  }
  const decipher = createDecipheriv(CIPHER, deriveKey(secret), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64url")), decipher.final()]).toString("utf8");
  return normalizeAiProviderConfig(JSON.parse(plaintext) as Partial<AiProviderConfig>);
}

export function mergeAiProviderConfigSecrets(existing: AiProviderConfig | undefined, next: Partial<AiProviderConfig>): AiProviderConfig {
  const normalizedExisting = existing ? normalizeAiProviderConfig(existing) : normalizeAiProviderConfig(undefined);
  return normalizeAiProviderConfig({
    provider: next.provider ?? normalizedExisting.provider,
    baseUrl: next.baseUrl ?? normalizedExisting.baseUrl,
    apiKey: next.apiKey?.trim() ? next.apiKey : normalizedExisting.apiKey,
    model: next.model ?? normalizedExisting.model,
    timeoutMs: next.timeoutMs ?? normalizedExisting.timeoutMs
  });
}

function normalizeTimeout(value: number | undefined): number {
  return Number.isFinite(value) && Number(value) > 0 ? Math.min(Math.floor(Number(value)), 60000) : DEFAULT_TIMEOUT_MS;
}

function deriveKey(secret: string): Buffer {
  if (!secret || secret.length < 16) {
    throw new Error("EMAIL_CONFIG_SECRET or APP_SECRET must be at least 16 characters for AI provider config encryption");
  }
  return createHash("sha256").update(secret).digest();
}
