import type { NextRequest } from "next/server";
import { getCrmRepository } from "@/lib/crm/repository";
import { extractRequestGeo, extractRequestIp } from "@/lib/email/tracking";

import { withApiMetrics } from "@/lib/api";
export const dynamic = "force-dynamic";

async function getApiMetricsHandler(request: NextRequest, { params }: { params: { trackingId: string } }) {
  const targetUrl = request.nextUrl.searchParams.get("u") ?? "";
  const geo = extractRequestGeo(request.headers);
  await getCrmRepository().recordEmailTrackingEvent(params.trackingId, {
    type: "click",
    ip: extractRequestIp(request.headers),
    userAgent: request.headers.get("user-agent") ?? undefined,
    url: targetUrl,
    country: geo.country,
    timezone: geo.timezone
  });
  if (!/^https?:\/\//i.test(targetUrl)) {
    return new Response("Invalid tracking target", { status: 400 });
  }
  return Response.redirect(targetUrl, 302);
}

export const GET = withApiMetrics("GET /api/email/track/click/[trackingId]", getApiMetricsHandler);
