export function getAppBaseUrl(input: string | URL | Request): string {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) {
    const url = new URL(configured);
    return url.origin;
  }

  if (typeof input === "string" || input instanceof URL) {
    return new URL(input).origin;
  }

  const requestOrigin = new URL(input.url).origin;
  const origin = input.headers.get("origin");
  if (origin && isAllowedRequestOrigin(origin, requestOrigin)) {
    return new URL(origin).origin;
  }
  return requestOrigin;
}

export function appUrl(path: string, input: string | URL | Request): URL {
  return new URL(path, getAppBaseUrl(input));
}

export function getTrustedRequestOrigin(requestUrl: string | URL): string {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) {
    return new URL(configured).origin;
  }
  return new URL(requestUrl).origin;
}

export function isAllowedRequestOrigin(origin: string, requestOrigin: string): boolean {
  let originUrl: URL;
  let requestUrl: URL;
  try {
    originUrl = new URL(origin);
    requestUrl = new URL(requestOrigin);
  } catch {
    return false;
  }

  if (originUrl.origin === requestUrl.origin) {
    return true;
  }

  return originUrl.protocol === requestUrl.protocol && isLoopbackHost(originUrl.hostname) && isLoopbackHost(requestUrl.hostname);
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}
