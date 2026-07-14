import type { MediaAssetScope } from "@prisma/client";
import type { NextRequest } from "next/server";
import { ApiError, getRequestContext, handleApiError, ok, parseJson, withApiMetrics } from "@/lib/api";
import { mediaAssetCreateSchema } from "@/lib/crm/api-schemas";
import { buildDiscussionTargetKey, parseDiscussionTarget } from "@/lib/discussions/target";
import { createMediaAsset, listMediaAssets } from "@/lib/media/service";
import { getCrmRepository } from "@/lib/crm/repository";

export const dynamic = "force-dynamic";

async function getHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    const url = new URL(request.url);
    if (![...url.searchParams.keys()].length) return ok(await getCrmRepository().listMediaAssets(context));
    const scope = url.searchParams.get("scope")?.toUpperCase();
    if (scope && scope !== "WORKSPACE" && scope !== "TARGET") throw new ApiError(400, "VALIDATION_ERROR", "Media scope is invalid");
    return ok(await listMediaAssets(context, {
      scope: scope as MediaAssetScope | undefined,
      targetKey: url.searchParams.get("targetKey") || undefined,
      query: url.searchParams.get("q") || undefined,
      contentType: url.searchParams.get("type") || undefined,
      includeArchived: url.searchParams.get("archived") === "true",
      limit: Number(url.searchParams.get("limit") || 50),
      cursor: url.searchParams.get("cursor") || undefined
    }));
  } catch (error) { return handleApiError(error, request); }
}

async function postHandler(request: NextRequest) {
  try {
    const context = await getRequestContext(request);
    if ((request.headers.get("content-type") || "").includes("application/json")) {
      const input = await parseJson(request, mediaAssetCreateSchema);
      const bytes = Buffer.from(input.contentBase64, "base64");
      const asset = await createMediaAsset(context, { name: input.name, contentType: input.contentType || "application/octet-stream", bytes, scope: "WORKSPACE" });
      return ok({ ...asset, contentBase64: input.contentBase64 }, { status: 201 });
    }
    const form = await request.formData();
    const scope = String(form.get("scope") || "WORKSPACE").toUpperCase();
    if (scope !== "WORKSPACE" && scope !== "TARGET") throw new ApiError(400, "VALIDATION_ERROR", "Media scope is invalid");
    let targetKey: string | undefined;
    if (scope === "TARGET") targetKey = buildDiscussionTargetKey(parseDiscussionTarget({ type: form.get("targetType"), objectKey: form.get("objectKey"), targetId: form.get("targetId") }));
    const files = form.getAll("files").filter((item): item is File => item instanceof File);
    if (!files.length || files.length > 20) throw new ApiError(400, "VALIDATION_ERROR", "Upload between 1 and 20 files");
    const results = [];
    for (const file of files) {
      try {
        const asset = await createMediaAsset(context, { name: file.name, contentType: file.type || "application/octet-stream", bytes: new Uint8Array(await file.arrayBuffer()), scope, targetKey });
        results.push({ fileName: file.name, ok: true as const, asset });
      } catch (error) {
        results.push({ fileName: file.name, ok: false as const, error: error instanceof Error ? error.message : "Upload failed" });
      }
    }
    return ok({ results }, { status: 201 });
  } catch (error) { return handleApiError(error, request); }
}

export const GET = withApiMetrics("GET /api/media-assets", getHandler);
export const POST = withApiMetrics("POST /api/media-assets", postHandler);
