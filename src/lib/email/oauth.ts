import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { EmailConnectionConfig, EmailProviderType } from "@/lib/crm/types";
import { getOAuthEmailProviderCapability, isOAuthEmailProvider, type OAuthEmailProviderType } from "@/lib/email/providers";

export interface OAuthProviderConfig {
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
}

export interface OAuthRefreshOptions {
  now?: Date;
  fetchImpl?: typeof fetch;
  providerConfig?: Partial<OAuthProviderConfig>;
}

export interface EmailOAuthState {
  provider: OAuthEmailProviderType;
  workspaceId: string;
  userId: string;
  emailAddress: string;
  name: string;
  syncEnabled: boolean;
  sendEnabled: boolean;
  createdAt: string;
  nonce: string;
}

export interface BuildOAuthAuthorizationUrlInput {
  provider: OAuthEmailProviderType;
  redirectUri: string;
  state: string;
  providerConfig?: Partial<OAuthProviderConfig>;
}

export interface OAuthCodeExchangeInput {
  provider: OAuthEmailProviderType;
  code: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
  providerConfig?: Partial<OAuthProviderConfig>;
  now?: Date;
}

const EXPIRY_SKEW_MS = 60_000;
const DEFAULT_STATE_MAX_AGE_MS = 10 * 60 * 1000;

export function isOAuthProvider(provider: EmailProviderType): provider is "gmail" | "outlook" {
  return isOAuthEmailProvider(provider);
}

export function assertOAuthConfig(provider: EmailProviderType, config: EmailConnectionConfig): void {
  if (!isOAuthProvider(provider)) {
    throw new Error("Email account is not an OAuth provider");
  }
  if (config.oauthProvider && config.oauthProvider !== provider) {
    throw new Error("Email OAuth provider does not match the account provider");
  }
  if (!config.accessToken && !config.refreshToken) {
    throw new Error(`${provider} OAuth connection requires an access token or refresh token`);
  }
}

export function shouldRefreshOAuthToken(config: EmailConnectionConfig, now = new Date()): boolean {
  if (!config.refreshToken) {
    return false;
  }
  if (!config.accessToken || !config.expiresAt) {
    return true;
  }
  const expiresAt = Date.parse(config.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt - now.getTime() <= EXPIRY_SKEW_MS;
}

export async function refreshOAuthAccessToken(
  provider: OAuthEmailProviderType,
  config: EmailConnectionConfig,
  options: OAuthRefreshOptions = {}
): Promise<EmailConnectionConfig> {
  assertOAuthConfig(provider, config);
  if (!config.refreshToken) {
    return config;
  }
  if (!shouldRefreshOAuthToken(config, options.now)) {
    return config;
  }

  const providerConfig = resolveOAuthProviderConfig(provider, options.providerConfig);
  const response = await (options.fetchImpl ?? fetch)(providerConfig.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: config.refreshToken,
      client_id: providerConfig.clientId,
      client_secret: providerConfig.clientSecret,
      ...(providerConfig.scope ? { scope: providerConfig.scope } : {})
    })
  });

  if (!response.ok) {
    throw new Error(`${provider} OAuth token refresh failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    token_type?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!payload.access_token) {
    throw new Error(`${provider} OAuth token refresh returned no access token`);
  }

  const now = options.now ?? new Date();
  return {
    ...config,
    oauthProvider: provider,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? config.refreshToken,
    tokenType: payload.token_type ?? config.tokenType ?? "Bearer",
    expiresAt: typeof payload.expires_in === "number" ? new Date(now.getTime() + payload.expires_in * 1000).toISOString() : config.expiresAt,
    scope: payload.scope ?? config.scope
  };
}

export function buildOAuthAuthorizationUrl(input: BuildOAuthAuthorizationUrlInput): string {
  const providerConfig = resolveOAuthProviderConfig(input.provider, input.providerConfig);
  const url = new URL(providerConfig.authUrl);
  url.searchParams.set("client_id", providerConfig.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", providerConfig.scope ?? getOAuthEmailProviderCapability(input.provider).defaultScope);
  url.searchParams.set("state", input.state);
  if (input.provider === "gmail") {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
  }
  return url.toString();
}

export async function exchangeOAuthAuthorizationCode(input: OAuthCodeExchangeInput): Promise<EmailConnectionConfig> {
  const providerConfig = resolveOAuthProviderConfig(input.provider, input.providerConfig);
  const response = await (input.fetchImpl ?? fetch)(providerConfig.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: providerConfig.clientId,
      client_secret: providerConfig.clientSecret
    })
  });
  if (!response.ok) {
    throw new Error(`${input.provider} OAuth code exchange failed with HTTP ${response.status}`);
  }
  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    token_type?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!payload.access_token) {
    throw new Error(`${input.provider} OAuth code exchange returned no access token`);
  }
  const now = input.now ?? new Date();
  return {
    oauthProvider: input.provider,
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    tokenType: payload.token_type ?? "Bearer",
    expiresAt: typeof payload.expires_in === "number" ? new Date(now.getTime() + payload.expires_in * 1000).toISOString() : undefined,
    scope: payload.scope ?? providerConfig.scope
  };
}

export function createEmailOAuthState(input: Omit<EmailOAuthState, "createdAt" | "nonce">, secret = stateSecret()): string {
  const payload: EmailOAuthState = {
    ...input,
    createdAt: new Date().toISOString(),
    nonce: randomBytes(12).toString("base64url")
  };
  return signState(payload, secret);
}

export function verifyEmailOAuthState(value: string, secret = stateSecret(), now = new Date(), maxAgeMs = DEFAULT_STATE_MAX_AGE_MS): EmailOAuthState {
  const [payloadText, signature] = value.split(".");
  if (!payloadText || !signature) {
    throw new Error("OAuth state is invalid");
  }
  const expected = hmac(payloadText, secret);
  if (!safeEqual(signature, expected)) {
    throw new Error("OAuth state signature is invalid");
  }
  const payload = JSON.parse(Buffer.from(payloadText, "base64url").toString("utf8")) as EmailOAuthState;
  const createdAt = Date.parse(payload.createdAt);
  if (!Number.isFinite(createdAt) || now.getTime() - createdAt > maxAgeMs) {
    throw new Error("OAuth state has expired");
  }
  if (!isOAuthProvider(payload.provider)) {
    throw new Error("OAuth state provider is invalid");
  }
  return payload;
}

function resolveOAuthProviderConfig(provider: OAuthEmailProviderType, overrides?: Partial<OAuthProviderConfig>): OAuthProviderConfig {
  const capability = getOAuthEmailProviderCapability(provider);
  const prefix = capability.oauthEnvPrefix;
  const authUrl =
    overrides?.authUrl ??
    process.env[`${prefix}_OAUTH_AUTH_URL`] ??
    capability.defaultAuthUrl;
  const tokenUrl =
    overrides?.tokenUrl ??
    process.env[`${prefix}_OAUTH_TOKEN_URL`] ??
    capability.defaultTokenUrl;
  const clientId = overrides?.clientId ?? process.env[`${prefix}_OAUTH_CLIENT_ID`] ?? "";
  const clientSecret = overrides?.clientSecret ?? process.env[`${prefix}_OAUTH_CLIENT_SECRET`] ?? "";
  const scope = overrides?.scope ?? process.env[`${prefix}_OAUTH_SCOPE`] ?? capability.defaultScope;

  if (!clientId || !clientSecret) {
    throw new Error(`${prefix}_OAUTH_CLIENT_ID and ${prefix}_OAUTH_CLIENT_SECRET are required to refresh OAuth tokens`);
  }

  return { authUrl, tokenUrl, clientId, clientSecret, scope };
}

function signState(payload: EmailOAuthState, secret: string): string {
  const payloadText = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${payloadText}.${hmac(payloadText, secret)}`;
}

function hmac(value: string, secret: string): string {
  if (!secret || secret.length < 16) {
    throw new Error("APP_SECRET or EMAIL_CONFIG_SECRET must be at least 16 characters for OAuth state signing");
  }
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function stateSecret(): string {
  return process.env.EMAIL_OAUTH_STATE_SECRET ?? process.env.APP_SECRET ?? process.env.EMAIL_CONFIG_SECRET ?? "";
}
