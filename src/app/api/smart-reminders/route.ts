export const dynamic = "force-dynamic";

import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, withApiMetrics } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";
import type { SmartReminder } from "@/lib/crm/types";

async function getApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const status = request.nextUrl.searchParams.get("status") as SmartReminder["status"] | null;
    const snoozed = request.nextUrl.searchParams.get("snoozed");
    const limit = Number(request.nextUrl.searchParams.get("limit"));
    return ok(
      await getCrmRepository().listSmartReminders(context, {
        status: status ?? undefined,
        snoozed: snoozed === "false" ? false : undefined,
        kind: (request.nextUrl.searchParams.get("kind") as SmartReminder["kind"] | null) ?? undefined,
        objectKey: request.nextUrl.searchParams.get("objectKey") ?? undefined,
        recordId: request.nextUrl.searchParams.get("recordId") ?? undefined,
        limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : undefined
      })
    );
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/smart-reminders", getApiMetricsHandler);
