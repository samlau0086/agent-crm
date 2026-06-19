export interface LoginRateLimitIdentity {
  email: string;
  ip: string;
}

export interface LoginRateLimitResult {
  limited: boolean;
  retryAfterSeconds?: number;
}

interface LoginAttemptBucket {
  count: number;
  firstFailedAt: number;
  lockedUntil?: number;
}

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_LOCK_MS = 15 * 60 * 1000;
const attempts = new Map<string, LoginAttemptBucket>();

export function getLoginClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "local";
}

export function isLoginRateLimited(identity: LoginRateLimitIdentity, now = Date.now()): LoginRateLimitResult {
  const config = getLoginRateLimitConfig();
  if (config.maxAttempts <= 0) {
    return { limited: false };
  }

  const key = loginRateLimitKey(identity);
  const bucket = attempts.get(key);
  if (!bucket) {
    return { limited: false };
  }

  if (bucket.lockedUntil && bucket.lockedUntil > now) {
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.lockedUntil - now) / 1000))
    };
  }

  if (bucket.lockedUntil && bucket.lockedUntil <= now) {
    attempts.delete(key);
    return { limited: false };
  }

  if (now - bucket.firstFailedAt >= config.windowMs) {
    attempts.delete(key);
  }

  return { limited: false };
}

export function recordFailedLogin(identity: LoginRateLimitIdentity, now = Date.now()): LoginRateLimitResult {
  const config = getLoginRateLimitConfig();
  if (config.maxAttempts <= 0) {
    return { limited: false };
  }

  const key = loginRateLimitKey(identity);
  const current = attempts.get(key);
  const bucket =
    current && now - current.firstFailedAt < config.windowMs
      ? current
      : {
          count: 0,
          firstFailedAt: now
        };

  bucket.count += 1;
  if (bucket.count >= config.maxAttempts) {
    bucket.lockedUntil = now + config.lockMs;
  }
  attempts.set(key, bucket);
  return isLoginRateLimited(identity, now);
}

export function clearFailedLogin(identity: LoginRateLimitIdentity): void {
  attempts.delete(loginRateLimitKey(identity));
}

export function resetLoginRateLimitsForTests(): void {
  attempts.clear();
}

function loginRateLimitKey(identity: LoginRateLimitIdentity): string {
  return `${identity.email.trim().toLowerCase() || "unknown"}:${identity.ip.trim() || "local"}`;
}

function getLoginRateLimitConfig(): { maxAttempts: number; windowMs: number; lockMs: number } {
  return {
    maxAttempts: readPositiveInteger("LOGIN_RATE_LIMIT_MAX_ATTEMPTS", DEFAULT_MAX_ATTEMPTS),
    windowMs: readPositiveInteger("LOGIN_RATE_LIMIT_WINDOW_MS", DEFAULT_WINDOW_MS),
    lockMs: readPositiveInteger("LOGIN_RATE_LIMIT_LOCK_MS", DEFAULT_LOCK_MS)
  };
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}
