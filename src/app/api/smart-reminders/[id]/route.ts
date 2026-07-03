export const dynamic = "force-dynamic";

import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { smartReminderUpdateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

type RouteParams = { params: { id: string } };

async function patchApiMetricsHandler(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, smartReminderUpdateSchema);
    return ok(
      await getCrmRepository().updateSmartReminder(context, params.id, {
        status: body.status,
        snoozedUntil: body.snoozedUntil === "" ? null : body.snoozedUntil
      })
    );
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const PATCH = withApiMetrics("PATCH /api/smart-reminders/:id", patchApiMetricsHandler);
