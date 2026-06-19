const BASE_SECURITY_HEADERS: Array<[string, string]> = [
  ["X-Content-Type-Options", "nosniff"],
  ["X-Frame-Options", "DENY"],
  ["Referrer-Policy", "same-origin"],
  ["Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()"],
  ["Content-Security-Policy", "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"]
];

export function buildSecurityHeaders(env: NodeJS.ProcessEnv = process.env): Array<[string, string]> {
  const headers = [...BASE_SECURITY_HEADERS];
  if (shouldEnableHsts(env)) {
    headers.push(["Strict-Transport-Security", "max-age=31536000; includeSubDomains"]);
  }
  return headers;
}

export function applySecurityHeaders(headers: Headers, env: NodeJS.ProcessEnv = process.env): void {
  for (const [name, value] of buildSecurityHeaders(env)) {
    headers.set(name, value);
  }
}

function shouldEnableHsts(env: NodeJS.ProcessEnv): boolean {
  if (env.NODE_ENV !== "production") {
    return false;
  }

  const configured = env.APP_BASE_URL?.trim();
  if (!configured) {
    return false;
  }

  try {
    return new URL(configured).protocol === "https:";
  } catch {
    return false;
  }
}
