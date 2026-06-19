import type { NextRequest } from "next/server";
import { z } from "zod";
import { getRequestContext, handleApiError, ok, parseJson } from "@/lib/api";
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

export async function GET(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    return ok(await getCrmRepository().getUsers(context));
  } catch (error) {
    return handleApiError(error, request);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, createUserSchema);
    return ok(await getCrmRepository().createUser(context, { ...body, teamId: body.teamId ?? undefined }), { status: 201 });
  } catch (error) {
    return handleApiError(error, request);
  }
}
