import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { AiProviderConfig, AiProviderProfile, AiProviderType } from "@/lib/crm/types";

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

export interface AiProviderSettingsBundle {
  providerConfig: AiProviderConfig;
  providerProfiles: AiProviderProfile[];
}

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

export function getAiProviderDefaults(provider: AiProviderType): { baseUrl: string; model: string } {
  return providerDefaults[provider];
}

export function normalizeAiProviderProfile(profile: Partial<AiProviderProfile> | undefined, fallback?: Partial<AiProviderProfile>): AiProviderProfile {
  const provider = normalizeAiProviderType(profile?.provider ?? fallback?.provider);
  const config = normalizeAiProviderConfig({
    provider,
    baseUrl: profile?.baseUrl ?? fallback?.baseUrl,
    apiKey: profile?.apiKey ?? fallback?.apiKey,
    model: profile?.model ?? fallback?.model,
    timeoutMs: profile?.timeoutMs ?? fallback?.timeoutMs
  });
  const key = normalizeProfileKey(profile?.key ?? fallback?.key ?? provider);
  return {
    ...config,
    key,
    name: normalizeProfileName(profile?.name ?? fallback?.name, provider),
    enabled: profile?.enabled ?? fallback?.enabled ?? true,
    hasApiKey: Boolean(config.apiKey)
  };
}

export function normalizeAiProviderProfiles(profiles: unknown, defaultConfig?: Partial<AiProviderConfig>): AiProviderProfile[] {
  const defaults = createDefaultAiProviderProfiles(defaultConfig);
  if (!Array.isArray(profiles)) {
    return defaults;
  }
  const fallbackByKey = new Map(defaults.map((profile) => [profile.key, profile]));
  const byKey = new Map<string, AiProviderProfile>();
  for (const raw of profiles) {
    if (!raw || typeof raw !== "object") continue;
    const partial = raw as Partial<AiProviderProfile>;
    const normalized = normalizeAiProviderProfile(partial, fallbackByKey.get(String(partial.key ?? "")));
    byKey.set(normalized.key, normalized);
  }
  return Array.from(byKey.values()).slice(0, 20);
}

export function createDefaultAiProviderProfiles(defaultConfig?: Partial<AiProviderConfig>): AiProviderProfile[] {
  const normalizedDefault = normalizeAiProviderConfig(defaultConfig);
  return [
    normalizeAiProviderProfile({ key: "openai", name: "OpenAI", provider: "openai", ...(normalizedDefault.provider === "openai" ? normalizedDefault : {}) }),
    normalizeAiProviderProfile({ key: "openrouter", name: "OpenRouter", provider: "openrouter", ...(normalizedDefault.provider === "openrouter" ? normalizedDefault : {}) }),
    normalizeAiProviderProfile({ key: "custom", name: "Custom Provider", provider: "custom", ...(normalizedDefault.provider === "custom" ? normalizedDefault : {}) })
  ];
}

export function publicAiProviderConfig(config: Partial<AiProviderConfig> | undefined): AiProviderConfig {
  const normalized = normalizeAiProviderConfig(config);
  return {
    ...normalized,
    apiKey: undefined,
    hasApiKey: Boolean(normalized.apiKey)
  };
}

export function publicAiProviderProfile(profile: Partial<AiProviderProfile>): AiProviderProfile {
  const normalized = normalizeAiProviderProfile(profile);
  return {
    ...normalized,
    apiKey: undefined,
    hasApiKey: Boolean(normalized.apiKey ?? profile.hasApiKey)
  };
}

export function publicAiProviderProfiles(profiles: AiProviderProfile[]): AiProviderProfile[] {
  return profiles.map(publicAiProviderProfile);
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

export function encryptAiProviderSettingsBundle(bundle: Partial<AiProviderSettingsBundle>, secret = process.env.EMAIL_CONFIG_SECRET ?? process.env.APP_SECRET ?? ""): string {
  const providerConfig = normalizeAiProviderConfig(bundle.providerConfig);
  const providerProfiles = normalizeAiProviderProfiles(bundle.providerProfiles, providerConfig);
  return encryptRawAiProviderPayload({ providerConfig, providerProfiles }, secret);
}

export function decryptAiProviderConfig(value: string, secret = process.env.EMAIL_CONFIG_SECRET ?? process.env.APP_SECRET ?? ""): AiProviderConfig {
  const raw = decryptRawAiProviderPayload(value, secret);
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "providerConfig" in raw) {
    return normalizeAiProviderConfig((raw as { providerConfig?: Partial<AiProviderConfig> }).providerConfig);
  }
  return normalizeAiProviderConfig(raw as Partial<AiProviderConfig>);
}

export function decryptAiProviderSettingsBundle(value: string | null | undefined, secret = process.env.EMAIL_CONFIG_SECRET ?? process.env.APP_SECRET ?? ""): AiProviderSettingsBundle {
  if (!value) {
    const providerConfig = normalizeAiProviderConfig(undefined);
    return { providerConfig, providerProfiles: normalizeAiProviderProfiles(undefined, providerConfig) };
  }
  const raw = decryptRawAiProviderPayload(value, secret);
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "providerConfig" in raw) {
    const providerConfig = normalizeAiProviderConfig((raw as { providerConfig?: Partial<AiProviderConfig> }).providerConfig);
    return {
      providerConfig,
      providerProfiles: normalizeAiProviderProfiles((raw as { providerProfiles?: unknown }).providerProfiles, providerConfig)
    };
  }
  const providerConfig = normalizeAiProviderConfig(raw as Partial<AiProviderConfig>);
  return { providerConfig, providerProfiles: normalizeAiProviderProfiles(undefined, providerConfig) };
}

function encryptRawAiProviderPayload(payload: unknown, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER, key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function decryptRawAiProviderPayload(value: string, secret: string): unknown {
  const [version, ivText, tagText, ciphertextText] = value.split(".");
  if (version !== VERSION || !ivText || !tagText || !ciphertextText) {
    throw new Error("AI provider config is invalid");
  }
  const decipher = createDecipheriv(CIPHER, deriveKey(secret), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64url")), decipher.final()]).toString("utf8");
  return JSON.parse(plaintext) as unknown;
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

export function mergeAiProviderProfilesSecrets(existing: AiProviderProfile[] | undefined, next: unknown, defaultConfig?: Partial<AiProviderConfig>): AiProviderProfile[] {
  const existingByKey = new Map((existing ?? []).map((profile) => [profile.key, profile]));
  if (!Array.isArray(next)) {
    return normalizeAiProviderProfiles(existing, defaultConfig);
  }
  return normalizeAiProviderProfiles(
    next.map((raw) => {
      if (!raw || typeof raw !== "object") return raw;
      const profile = raw as Partial<AiProviderProfile>;
      const current = existingByKey.get(String(profile.key ?? ""));
      return {
        ...profile,
        apiKey: profile.apiKey?.trim() ? profile.apiKey : current?.apiKey
      };
    }),
    defaultConfig
  );
}

export function resolveAiProviderConfigForAgent(
  providerConfig: Partial<AiProviderConfig> | undefined,
  providerProfiles: AiProviderProfile[] | undefined,
  agent: { providerProfileKey?: string; provider?: AiProviderType; baseUrl?: string; model?: string }
): AiProviderConfig {
  const base = normalizeAiProviderConfig(providerConfig);
  const profile = agent.providerProfileKey ? providerProfiles?.find((candidate) => candidate.key === agent.providerProfileKey && candidate.enabled) : undefined;
  return normalizeAiProviderConfig({
    ...base,
    ...profile,
    provider: agent.provider ?? profile?.provider ?? base.provider,
    baseUrl: agent.baseUrl ?? profile?.baseUrl ?? base.baseUrl,
    apiKey: profile?.apiKey ?? base.apiKey,
    model: agent.model || profile?.model || base.model
  });
}

function normalizeTimeout(value: number | undefined): number {
  return Number.isFinite(value) && Number(value) > 0 ? Math.min(Math.floor(Number(value)), 60000) : DEFAULT_TIMEOUT_MS;
}

function normalizeProfileKey(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") : "";
  return normalized && /^[a-z][a-z0-9_-]{1,60}$/.test(normalized) ? normalized : `provider-${randomBytes(4).toString("hex")}`;
}

function normalizeProfileName(value: unknown, provider: AiProviderType): string {
  const fallback = provider === "openai" ? "OpenAI" : provider === "openrouter" ? "OpenRouter" : provider === "gemini" ? "Gemini" : provider === "custom" ? "Custom Provider" : "OpenAI Compatible";
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : fallback;
}

function deriveKey(secret: string): Buffer {
  if (!secret || secret.length < 16) {
    throw new Error("EMAIL_CONFIG_SECRET or APP_SECRET must be at least 16 characters for AI provider config encryption");
  }
  return createHash("sha256").update(secret).digest();
}
