export const dynamic = "force-dynamic";

import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, parseOptionalJson, withApiMetrics } from "@/lib/api";
import { recordDeleteRequestSchema, smartReminderUpdateSchema } from "@/lib/crm/api-schemas";
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

async function deleteApiMetricsHandler(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    const body = await parseOptionalJson(request, recordDeleteRequestSchema, {});
    const changeRequest = await getCrmRepository().requestSmartReminderDelete(context, params.id, body.changeReason ?? "");
    return ok({ pendingApproval: true, request: changeRequest }, { status: 202 });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const DELETE = withApiMetrics("DELETE /api/smart-reminders/:id", deleteApiMetricsHandler);
