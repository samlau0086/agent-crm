import type { NextRequest } from "next/server";
import { getCrmRepository } from "@/lib/crm/repository";
import { extractRequestGeo, extractRequestIp } from "@/lib/email/tracking";

export const dynamic = "force-dynamic";

const transparentPixel = Buffer.from("R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==", "base64");

export async function GET(request: NextRequest, { params }: { params: { trackingId: string } }) {
  const geo = extractRequestGeo(request.headers);
  await getCrmRepository().recordEmailTrackingEvent(params.trackingId, {
    type: "open",
    ip: extractRequestIp(request.headers),
    userAgent: request.headers.get("user-agent") ?? undefined,
    country: geo.country,
    timezone: geo.timezone
  });
  return new Response(transparentPixel, {
    headers: {
      "content-type": "image/gif",
      "cache-control": "no-store, max-age=0"
    }
  });
}
