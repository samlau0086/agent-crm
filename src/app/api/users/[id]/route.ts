
export const dynamic = "force-dynamic";
﻿import type { NextRequest } from "next/server";
import { z } from "zod";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { getCrmRepository } from "@/lib/crm/repository";

const optionalIdSchema = z
  .union([z.string().min(1), z.literal(""), z.null()])
  .optional()
  .transform((value) => value || undefined);

const updateUserSchema = z
  .object({
    email: z.string().email().optional(),
    name: z.string().trim().min(1).optional(),
    roleId: z.string().min(1).optional(),
    teamId: optionalIdSchema,
    active: z.boolean().optional(),
    password: z.string().min(8).optional()
  })
  .strict();

interface RouteParams {
  params: { id: string };
}

async function patchApiMetricsHandler(request: NextRequest, { params }: RouteParams) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, updateUserSchema);
    return ok(await getCrmRepository().updateUser(context, params.id, { ...body, teamId: body.teamId ?? undefined }));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const PATCH = withApiMetrics("PATCH /api/users/[id]", patchApiMetricsHandler);
