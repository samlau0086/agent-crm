export const dynamic = "force-dynamic";
import type { NextRequest } from "next/server";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import { activityCreateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";
import type { ActivityListQuery, ActivityType } from "@/lib/crm/types";

const activityTypes: ActivityType[] = ["note", "call", "meeting", "task", "email", "stage_change"];

async function getApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    return ok(await getCrmRepository().listActivities(context, parseActivityListQuery(request)));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/activities", getApiMetricsHandler);

async function postApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, activityCreateSchema);
    return ok(await getCrmRepository().createActivity(context, { ...body, recordId: body.recordId ?? undefined }), { status: 201 });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const POST = withApiMetrics("POST /api/activities", postApiMetricsHandler);

function parseActivityListQuery(request: NextRequest): ActivityListQuery {
  const searchParams = request.nextUrl.searchParams;
  const type = searchParams.get("type")?.trim();
  if (type && !activityTypes.includes(type as ActivityType)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Activity type is invalid");
  }

  return {
    recordId: searchParams.get("recordId") ?? undefined,
    type: type ? (type as ActivityType) : undefined,
    completed: parseOptionalBoolean(searchParams.get("completed"), "completed"),
    archived: parseOptionalBoolean(searchParams.get("archived"), "archived"),
    dueFrom: parseOptionalDate(searchParams.get("dueFrom"), "dueFrom"),
    dueTo: parseOptionalDate(searchParams.get("dueTo"), "dueTo"),
    tags: parseTags(searchParams.get("tags"))
  };
}

function parseOptionalBoolean(value: string | null, field: string): boolean | undefined {
  if (value === null || value === "") {
    return undefined;
  }
  if (value === "true" || value === "1") {
    return true;
  }
  if (value === "false" || value === "0") {
    return false;
  }
  throw new ApiError(400, "VALIDATION_ERROR", `${field} must be true or false`);
}

function parseOptionalDate(value: string | null, field: string): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} must be a valid date`);
  }
  return date.toISOString();
}

function parseTags(value: string | null): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const tags = value
    .split(/[,;\uFF1B\uFF0C]/)
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
  return tags.length > 0 ? Array.from(new Set(tags)).slice(0, 50) : undefined;
}
