import type { NextRequest } from "next/server";
import { getCrmRepository } from "@/lib/crm/repository";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { extractRequestGeo, extractRequestIp } from "@/lib/email/tracking";

import { withApiMetrics } from "@/lib/api";
export const dynamic = "force-dynamic";

const transparentPixel = Buffer.from("R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==", "base64");

async function getApiMetricsHandler(request: NextRequest, { params }: { params: { trackingId: string } }) {
  if (request.cookies.get(SESSION_COOKIE_NAME)?.value) {
    return buildTransparentPixelResponse();
  }
  const geo = extractRequestGeo(request.headers);
  await getCrmRepository().recordEmailTrackingEvent(params.trackingId, {
    type: "open",
    ip: extractRequestIp(request.headers),
    userAgent: request.headers.get("user-agent") ?? undefined,
    country: geo.country,
    timezone: geo.timezone
  });
  return buildTransparentPixelResponse();
}

function buildTransparentPixelResponse() {
  return new Response(transparentPixel, {
    headers: {
      "content-type": "image/gif",
      "cache-control": "no-store, max-age=0"
    }
  });
}

export const GET = withApiMetrics("GET /api/email/track/open/[trackingId]", getApiMetricsHandler);
