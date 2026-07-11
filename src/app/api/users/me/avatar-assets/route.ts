import type { NextRequest } from "next/server";
import type { z } from "zod";
import { getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { currentUserAvatarMediaAssetCreateSchema } from "@/lib/crm/api-schemas";
import { getCrmRepository } from "@/lib/crm/repository";

export const dynamic = "force-dynamic";

async function postApiMetricsHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const body = await parseJson<z.infer<typeof currentUserAvatarMediaAssetCreateSchema>>(request, currentUserAvatarMediaAssetCreateSchema);
    return ok(await getCrmRepository().createCurrentUserAvatarMediaAsset(context, body), { status: 201 });
  } catch (error) {
    return handleApiError(error, request);
  }
}

export const POST = withApiMetrics("POST /api/users/me/avatar-assets", postApiMetricsHandler);
