import { Prisma, type MediaAsset, type MediaAssetScope } from "@prisma/client";
import { ApiError } from "@/lib/api-error";
import { hasPermission, requirePermission } from "@/lib/auth/rbac";
import type { RequestContext } from "@/lib/crm/types";
import { prisma } from "@/lib/db";
import { assertDiscussionTargetAccess, parseDiscussionTargetKey } from "@/lib/discussions/target";
import { createMediaStorageKey, deleteMediaObject, getMediaObject, putMediaObject, validateMediaFile } from "@/lib/media/storage";

export interface MediaAssetDto {
  id: string;
  workspaceId: string;
  name: string;
  contentType: string;
  size: number;
  scope: "WORKSPACE" | "TARGET";
  targetKey?: string;
  archivedAt?: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  contentUrl: string;
  referenceCount: number;
}

export async function assertMediaAssetAccess(context: RequestContext, asset: Pick<MediaAsset, "workspaceId" | "scope" | "targetKey">, write = false): Promise<void> {
  if (asset.workspaceId !== context.workspaceId) throw new ApiError(404, "NOT_FOUND", "Media asset not found");
  requirePermission(context, write ? "crm.write" : "crm.read");
  if (asset.scope === "TARGET") {
    if (!asset.targetKey) throw new ApiError(404, "NOT_FOUND", "Media target not found");
    await assertDiscussionTargetAccess(context, parseDiscussionTargetKey(asset.targetKey), write);
  }
}

export async function listMediaAssets(context: RequestContext, input: { scope?: MediaAssetScope; targetKey?: string; query?: string; contentType?: string; includeArchived?: boolean; limit?: number; cursor?: string }) {
  requirePermission(context, "crm.read");
  if (input.scope === "TARGET") {
    if (!input.targetKey) throw new ApiError(400, "VALIDATION_ERROR", "targetKey is required");
    await assertDiscussionTargetAccess(context, parseDiscussionTargetKey(input.targetKey));
  }
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const where: Prisma.MediaAssetWhereInput = {
    workspaceId: context.workspaceId,
    ...(input.scope ? { scope: input.scope } : {}),
    ...(input.scope === "TARGET" ? { targetKey: input.targetKey } : {}),
    ...(!input.includeArchived ? { archivedAt: null } : {}),
    ...(input.query ? { name: { contains: input.query, mode: "insensitive" } } : {}),
    ...(input.contentType === "image" ? { contentType: { startsWith: "image/" } } : input.contentType === "file" ? { NOT: { contentType: { startsWith: "image/" } } } : {})
  };
  const rows = await prisma.mediaAsset.findMany({ where, include: { _count: { select: { discussionAttachments: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1, ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}) });
  const nextCursor = rows.length > limit ? rows[limit - 1]?.id : undefined;
  if (rows.length > limit) rows.pop();
  const references = await getMediaReferenceCounts(rows.map((row) => row.id));
  return { assets: rows.map((row) => mapMediaAsset(row, references.get(row.id) ?? row._count.discussionAttachments)), nextCursor };
}

export async function createMediaAsset(context: RequestContext, input: { name: string; contentType: string; bytes: Uint8Array; scope: MediaAssetScope; targetKey?: string }): Promise<MediaAssetDto> {
  requirePermission(context, "crm.write");
  await cleanupExpiredTargetMedia(context.workspaceId);
  validateMediaFile(input.name, input.contentType, input.bytes.byteLength);
  if (input.scope === "TARGET") {
    if (!input.targetKey) throw new ApiError(400, "VALIDATION_ERROR", "targetKey is required");
    await assertDiscussionTargetAccess(context, parseDiscussionTargetKey(input.targetKey), true);
  }
  const storageKey = createMediaStorageKey(context.workspaceId);
  await putMediaObject(storageKey, input.bytes);
  try {
    const asset = await prisma.mediaAsset.create({ data: { workspaceId: context.workspaceId, name: input.name.trim(), contentType: input.contentType || "application/octet-stream", size: input.bytes.byteLength, storageKey, contentBase64: null, scope: input.scope, targetKey: input.scope === "TARGET" ? input.targetKey : null, createdById: context.user.id } });
    await audit(context, "create", asset.id, { scope: asset.scope, targetKey: asset.targetKey, size: asset.size });
    return mapMediaAsset(asset, 0);
  } catch (error) {
    await deleteMediaObject(storageKey).catch(() => undefined);
    throw error;
  }
}

export async function cleanupExpiredTargetMedia(workspaceId?: string): Promise<number> {
  const rows = await prisma.mediaAsset.findMany({ where: { ...(workspaceId ? { workspaceId } : {}), scope: "TARGET", createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }, discussionAttachments: { none: {} } }, take: 100 });
  for (const asset of rows) {
    await prisma.mediaAsset.delete({ where: { id: asset.id } });
    if (asset.storageKey) await deleteMediaObject(asset.storageKey).catch(() => undefined);
  }
  return rows.length;
}

export async function getMediaAssetContent(context: RequestContext, assetId: string) {
  const asset = await prisma.mediaAsset.findFirst({ where: { id: assetId, workspaceId: context.workspaceId } });
  if (!asset) throw new ApiError(404, "NOT_FOUND", "Media asset not found");
  await assertMediaAssetAccess(context, asset);
  const bytes = asset.storageKey ? await getMediaObject(asset.storageKey) : asset.contentBase64 ? Buffer.from(asset.contentBase64, "base64") : undefined;
  if (!bytes) throw new ApiError(404, "NOT_FOUND", "Media content not found");
  return { asset, bytes };
}

export async function updateMediaAsset(context: RequestContext, assetId: string, input: { name?: string; archived?: boolean; promoteToWorkspace?: boolean }): Promise<MediaAssetDto> {
  const existing = await prisma.mediaAsset.findFirst({ where: { id: assetId, workspaceId: context.workspaceId }, include: { _count: { select: { discussionAttachments: true } } } });
  if (!existing) throw new ApiError(404, "NOT_FOUND", "Media asset not found");
  await assertMediaAssetAccess(context, existing, true);
  if ((input.archived !== undefined || input.promoteToWorkspace) && !hasPermission(context, "crm.admin")) throw new ApiError(403, "FORBIDDEN", "Administrator permission is required");
  const asset = await prisma.mediaAsset.update({ where: { id: existing.id }, data: { name: input.name?.trim() || undefined, archivedAt: input.archived === true ? new Date() : input.archived === false ? null : undefined, scope: input.promoteToWorkspace ? "WORKSPACE" : undefined, targetKey: input.promoteToWorkspace ? null : undefined }, include: { _count: { select: { discussionAttachments: true } } } });
  await audit(context, "update", asset.id, input);
  return mapMediaAsset(asset, asset._count.discussionAttachments);
}

export async function deleteMediaAssets(context: RequestContext, assetIds: string[]): Promise<{ deleted: string[]; archived: string[] }> {
  if (!hasPermission(context, "crm.admin")) throw new ApiError(403, "FORBIDDEN", "Administrator permission is required");
  const rows = await prisma.mediaAsset.findMany({ where: { id: { in: [...new Set(assetIds)] }, workspaceId: context.workspaceId }, include: { _count: { select: { discussionAttachments: true, avatarUsers: true } } } });
  const references = await getMediaReferenceCounts(rows.map((row) => row.id));
  const deleted: string[] = [];
  const archived: string[] = [];
  for (const asset of rows) {
    const referenced = (references.get(asset.id) ?? asset._count.discussionAttachments + asset._count.avatarUsers) > 0;
    if (referenced) {
      await prisma.mediaAsset.update({ where: { id: asset.id }, data: { archivedAt: new Date() } });
      archived.push(asset.id);
    } else {
      await prisma.mediaAsset.delete({ where: { id: asset.id } });
      if (asset.storageKey) await deleteMediaObject(asset.storageKey).catch(() => undefined);
      deleted.push(asset.id);
    }
    await audit(context, referenced ? "archive" : "delete", asset.id, { referenced });
  }
  return { deleted, archived };
}

async function getMediaReferenceCounts(assetIds: string[]): Promise<Map<string, number>> {
  if (!assetIds.length) return new Map();
  const rows = await prisma.$queryRaw<Array<{ id: string; references: number }>>(Prisma.sql`
    SELECT m.id,
      (
        (SELECT COUNT(*) FROM "DiscussionAttachment" d WHERE d."mediaAssetId" = m.id) +
        (SELECT COUNT(*) FROM "User" u WHERE u."avatarMediaAssetId" = m.id) +
        (SELECT COUNT(*) FROM "CrmRecord" r WHERE r."workspaceId" = m."workspaceId" AND r.data::text LIKE ('%' || m.id || '%')) +
        (SELECT COUNT(*) FROM "DocumentTemplate" t WHERE t."workspaceId" = m."workspaceId" AND t."templateJson"::text LIKE ('%' || m.id || '%')) +
        (SELECT COUNT(*) FROM "EmailMessage" e WHERE e."workspaceId" = m."workspaceId" AND (COALESCE(e.attachments::text, '') LIKE ('%' || m.id || '%') OR COALESCE(e."bodyHtml", '') LIKE ('%' || m.id || '%'))) +
        (SELECT COUNT(*) FROM "Activity" a WHERE a."workspaceId" = m."workspaceId" AND COALESCE(a.body, '') LIKE ('%' || m.id || '%'))
      )::int AS references
    FROM "MediaAsset" m
    WHERE m.id IN (${Prisma.join(assetIds)})
  `);
  return new Map(rows.map((row) => [row.id, Number(row.references)]));
}

function mapMediaAsset(asset: MediaAsset, referenceCount: number): MediaAssetDto {
  return { id: asset.id, workspaceId: asset.workspaceId, name: asset.name, contentType: asset.contentType, size: asset.size, scope: asset.scope, targetKey: asset.targetKey ?? undefined, archivedAt: asset.archivedAt?.toISOString(), createdById: asset.createdById, createdAt: asset.createdAt.toISOString(), updatedAt: asset.updatedAt.toISOString(), contentUrl: `/api/media-assets/${encodeURIComponent(asset.id)}/content`, referenceCount };
}

async function audit(context: RequestContext, action: string, entityId: string, details: unknown) {
  await prisma.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.user.id, action, entityType: "media_asset", entityId, summary: `${action} media asset`, details: details as Prisma.InputJsonValue } });
}
