import { randomUUID } from "node:crypto";
import * as geoip from "geoip-lite";
import type { EmailInboundMetadata, EmailTrackingEvent } from "@/lib/crm/types";

export function createEmailTrackingId(): string {
  return `trk_${randomUUID().replace(/-/g, "")}`;
}

export function appendEmailTrackingHtml(html: string | undefined, trackingId: string): string | undefined {
  if (!html?.trim()) {
    return html;
  }
  const baseUrl = getTrackingBaseUrl();
  const trackedLinks = html.replace(/\shref=(["'])(https?:\/\/[^"']+)\1/gi, (_match, quote: string, url: string) => {
    const trackedUrl = `${baseUrl}/api/email/track/click/${encodeURIComponent(trackingId)}?u=${encodeURIComponent(url)}`;
    return ` href=${quote}${trackedUrl}${quote}`;
  });
  const pixel = `<img src="${baseUrl}/api/email/track/open/${encodeURIComponent(trackingId)}" width="1" height="1" alt="" style="display:none;width:1px;height:1px;opacity:0" />`;
  return /<\/body>/i.test(trackedLinks) ? trackedLinks.replace(/<\/body>/i, `${pixel}</body>`) : `${trackedLinks}${pixel}`;
}

export function buildTrackingEvent(
  type: EmailTrackingEvent["type"],
  input: { ip?: string; userAgent?: string; url?: string; country?: string; timezone?: string }
): EmailTrackingEvent {
  const geo = lookupIpGeo(input.ip);
  return {
    type,
    occurredAt: new Date().toISOString(),
    ip: input.ip,
    country: input.country ?? geo.country,
    timezone: input.timezone ?? geo.timezone,
    userAgent: input.userAgent,
    url: input.url
  };
}

export function extractRequestGeo(headers: Headers): { country?: string; timezone?: string } {
  const ipGeo = lookupIpGeo(extractRequestIp(headers));
  return {
    country: formatCountryCode(headers.get("cf-ipcountry")?.trim() || headers.get("x-vercel-ip-country")?.trim() || undefined) ?? ipGeo.country,
    timezone: headers.get("x-vercel-ip-timezone")?.trim() || ipGeo.timezone
  };
}

export function extractRequestIp(headers: Headers): string | undefined {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || headers.get("cf-connecting-ip")?.trim() || undefined;
}

export function extractInboundMetadata(rawHeaders: Record<string, string>): EmailInboundMetadata | undefined {
  const receivedHeader = rawHeaders.received;
  const sourceIp = extractPublicIp(receivedHeader ?? "");
  if (!sourceIp && !receivedHeader) {
    return undefined;
  }
  const geo = lookupIpGeo(sourceIp);
  return {
    sourceIp,
    country: geo.country,
    timezone: geo.timezone,
    receivedHeader
  };
}

function getTrackingBaseUrl(): string {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) {
    return new URL(configured).origin;
  }
  return "http://localhost:3000";
}

function extractPublicIp(value: string): string | undefined {
  const candidates = value.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? [];
  return candidates.find((candidate) => isPublicIpv4(candidate));
}

function lookupIpGeo(ip?: string): { country?: string; timezone?: string } {
  if (!ip || !isPublicIp(ip)) {
    return {};
  }
  const result = geoip.lookup(ip);
  return {
    country: formatCountryCode(result?.country),
    timezone: result?.timezone
  };
}

function formatCountryCode(countryCode?: string): string | undefined {
  if (!countryCode || countryCode.toUpperCase() === "XX") {
    return undefined;
  }
  const normalized = countryCode.toUpperCase();
  try {
    const label = new Intl.DisplayNames(["zh-CN"], { type: "region" }).of(normalized);
    return label ? `${label} (${normalized})` : normalized;
  } catch {
    return normalized;
  }
}

function isPublicIp(value: string): boolean {
  if (value.includes(":")) {
    const normalized = value.toLowerCase();
    return !(normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80"));
  }
  return isPublicIpv4(value);
}

function isPublicIpv4(value: string): boolean {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return !(a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 0 || a >= 224);
}
