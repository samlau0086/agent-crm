import type { NextRequest } from "next/server";
import { getCrmRepository } from "@/lib/crm/repository";
import { extractRequestGeo, extractRequestIp } from "@/lib/email/tracking";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: { trackingId: string } }) {
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
