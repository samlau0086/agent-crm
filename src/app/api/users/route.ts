
export const dynamic = "force-dynamic";
﻿import type { NextRequest } from "next/server";
import { z } from "zod";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";

const optionalIdSchema = z
  .union([z.string().min(1), z.literal(""), z.null()])
  .optional()
  .transform((value) => value || undefined);

const createUserSchema = z
  .object({
    email: z.string().email(),
    name: z.string().trim().min(1),
    roleId: z.string().min(1),
    teamId: optionalIdSchema,
    active: z.boolean().optional(),
    password: z.string().min(8)
  })
  .strict();

async function getApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    return ok(await getCrmRepository().getUsers(context));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const GET = withApiMetrics("GET /api/users", getApiMetricsHandler);

async function postApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, createUserSchema);
    return ok(await getCrmRepository().createUser(context, { ...body, teamId: body.teamId ?? undefined }), { status: 201 });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const POST = withApiMetrics("POST /api/users", postApiMetricsHandler);
