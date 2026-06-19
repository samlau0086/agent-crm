import type { NextRequest } from "next/server";
import { z } from "zod";
import { getRequestContext, handleApiError, ok, parseJson } from "@/lib/api";
import { normalizePasswordSetupPurpose } from "@/lib/auth/password-setup";
import { getCrmRepository } from "@/lib/crm/repository";
import { getAppBaseUrl } from "@/lib/security/app-origin";

const passwordLinkSchema = z
  .object({
    purpose: z.enum(["invite", "reset"]).optional()
  })
  .strict();

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson(request, passwordLinkSchema);
    const origin = getAppBaseUrl(request);
    return ok(await getCrmRepository().createPasswordSetupLink(context, params.id, origin, normalizePasswordSetupPurpose(body.purpose)));
  } catch (error) {
    return handleApiError(error, request);
  }
}
