import { getTrustedRequestOrigin, isAllowedRequestOrigin } from "@/lib/security/app-origin";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isUnsafeMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

export function shouldBlockCrossSiteMutation(input: {
  method: string;
  url: string;
  origin?: string | null;
  referer?: string | null;
  secFetchSite?: string | null;
}): boolean {
  if (!isUnsafeMethod(input.method)) {
    return false;
  }

  if (input.secFetchSite === "cross-site") {
    return true;
  }

  const trustedOrigin = getTrustedRequestOrigin(input.url);
  if (input.origin) {
    return !isAllowedRequestOrigin(input.origin, trustedOrigin);
  }

  if (input.referer) {
    return !isAllowedRequestOrigin(input.referer, trustedOrigin);
  }

  return false;
}
