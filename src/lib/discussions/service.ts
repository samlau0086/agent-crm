import { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api-error";
import { hasPermission } from "@/lib/auth/rbac";
import type { RequestContext } from "@/lib/crm/types";
import { prisma } from "@/lib/db";
import { assertDiscussionTargetAccess, buildDiscussionTargetKey, targetFromThread } from "@/lib/discussions/target";
import {
  MAX_DISCUSSION_ATTACHMENTS,
  MAX_DISCUSSION_MESSAGE_ATTACHMENT_BYTES,
  validateDiscussionFile
} from "@/lib/discussions/storage";
import { createMediaAsset, assertMediaAssetAccess } from "@/lib/media/service";
import { deleteMediaObject } from "@/lib/media/storage";
import type { DiscussionMessageDto, DiscussionMessagesPage, DiscussionNotificationDto, DiscussionTarget } from "@/lib/discussions/types";
import { discussionAncestorIds, groupDiscussionMessageIdsByRoot } from "@/lib/discussions/tree";

const messageInclude = {
  author: { select: { id: true, name: true, avatarMediaAssetId: true } },
  replyTo: { include: { author: { select: { name: true } } } },
  attachments: { include: { mediaAsset: true }, orderBy: { createdAt: "asc" as const } },
  mentions: { select: { userId: true } }
} satisfies Prisma.DiscussionMessageInclude;

type MessageWithRelations = Prisma.DiscussionMessageGetPayload<{ include: typeof messageInclude }>;

export function encodeDiscussionCursor(input: { createdAt: Date; id: string }): string {
  return Buffer.from(`${input.createdAt.toISOString()}|${input.id}`, "utf8").toString("base64url");
}

export function decodeDiscussionCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const [dateText, id, ...extra] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    const createdAt = new Date(dateText);
    if (!id || extra.length || Number.isNaN(createdAt.getTime())) throw new Error("invalid");
    return { createdAt, id };
  } catch {
    throw new ApiError(400, "VALIDATION_ERROR", "Discussion cursor is invalid");
  }
}

async function getThread(context: RequestContext, target: DiscussionTarget, create: boolean) {
  const targetKey = buildDiscussionTargetKey(target);
  if (!create) {
    return prisma.discussionThread.findUnique({ where: { workspaceId_targetKey: { workspaceId: context.workspaceId, targetKey } } });
  }
  return prisma.discussionThread.upsert({
    where: { workspaceId_targetKey: { workspaceId: context.workspaceId, targetKey } },
    create: {
      workspaceId: context.workspaceId,
      targetKey,
      targetType: target.type,
      objectKey: target.type === "record" ? target.objectKey : null,
      targetId: target.targetId
    },
    update: {}
  });
}

function cursorWhere(cursor: { createdAt: Date; id: string }, direction: "before" | "after"): Prisma.DiscussionMessageWhereInput {
  const comparison = direction === "before" ? "lt" : "gt";
  return {
    OR: [
      { createdAt: { [comparison]: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { [comparison]: cursor.id } }
    ]
  };
}

export async function listDiscussionMessages(
  context: RequestContext,
  target: DiscussionTarget,
  options: { before?: string; after?: string; focusId?: string; limit?: number }
): Promise<DiscussionMessagesPage> {
  await assertDiscussionTargetAccess(context, target);
  const thread = await getThread(context, target, false);
  if (!thread) return { messages: [], unreadCount: 0 };
  const requestedLimit = options.limit ?? 20;
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(Math.trunc(requestedLimit), 100)) : 20;
  const after = options.after ? decodeDiscussionCursor(options.after) : undefined;
  const before = options.before ? decodeDiscussionCursor(options.before) : undefined;
  if (after && before) throw new ApiError(400, "VALIDATION_ERROR", "Use either before or after cursor");
  const metadata = await prisma.discussionMessage.findMany({
    where: { workspaceId: context.workspaceId, threadId: thread.id },
    select: { id: true, replyToId: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }]
  });
  const treeItems = metadata.map((message) => ({ id: message.id, parentId: message.replyToId ?? undefined, createdAt: message.createdAt.toISOString() }));
  const readState = await prisma.discussionReadState.findUnique({
    where: { workspaceId_threadId_userId: { workspaceId: context.workspaceId, threadId: thread.id, userId: context.user.id } }
  });
  const unreadCount = await prisma.discussionMessage.count({
    where: {
      workspaceId: context.workspaceId,
      threadId: thread.id,
      authorId: { not: context.user.id },
      deletedAt: null,
      ...(readState ? { createdAt: { gt: readState.lastReadAt } } : {})
    }
  });
  if (after) {
    const rows = await prisma.discussionMessage.findMany({
      where: { workspaceId: context.workspaceId, threadId: thread.id, ...cursorWhere(after, "after") },
      include: messageInclude,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit
    });
    const ancestorIds = discussionAncestorIds(treeItems, rows.map((row) => row.id));
    const contextRows = ancestorIds.length ? await prisma.discussionMessage.findMany({ where: { id: { in: ancestorIds }, workspaceId: context.workspaceId, threadId: thread.id }, include: messageInclude, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }) : [];
    return {
      messages: rows.map(mapMessage),
      contextMessages: contextRows.map(mapMessage),
      unreadCount,
      ...(rows.at(-1) ? { latestCursor: encodeDiscussionCursor(rows.at(-1)!) } : {})
    };
  }

  const metadataById = new Map(metadata.map((message) => [message.id, message]));
  const rootGroups = groupDiscussionMessageIdsByRoot(treeItems);
  let roots = [...rootGroups.entries()].map(([rootId, messageIds]) => {
    const lastMessage = messageIds.map((id) => metadataById.get(id)!).sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id))[0]!;
    return { rootId, messageIds, createdAt: lastMessage.createdAt };
  }).sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.rootId.localeCompare(left.rootId));
  if (before) roots = roots.filter((root) => root.createdAt < before.createdAt || (root.createdAt.getTime() === before.createdAt.getTime() && root.rootId < before.id));
  const normalRootPage = roots.slice(0, limit + 1);
  const hasMore = normalRootPage.length > limit;
  if (hasMore) normalRootPage.pop();
  const focusedRoot = !before && options.focusId ? roots.find((root) => root.messageIds.includes(options.focusId!)) : undefined;
  const rootPage = focusedRoot && !normalRootPage.some((root) => root.rootId === focusedRoot.rootId) ? [...normalRootPage, focusedRoot] : normalRootPage;
  const selectedIds = rootPage.flatMap((root) => root.messageIds);
  const rows = selectedIds.length ? await prisma.discussionMessage.findMany({ where: { id: { in: selectedIds }, workspaceId: context.workspaceId, threadId: thread.id }, include: messageInclude, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }) : [];
  const newest = metadata.at(-1);
  const oldestRoot = normalRootPage.at(-1);
  return {
    messages: rows.map(mapMessage),
    unreadCount,
    ...(hasMore && oldestRoot ? { nextBefore: encodeDiscussionCursor({ createdAt: oldestRoot.createdAt, id: oldestRoot.rootId }) } : {}),
    ...(newest ? { latestCursor: encodeDiscussionCursor(newest) } : {})
  };
}

export async function uploadDiscussionAttachment(
  context: RequestContext,
  target: DiscussionTarget,
  file: { name: string; type: string; size: number; bytes: Uint8Array }
) {
  await assertDiscussionTargetAccess(context, target, true);
  validateDiscussionFile(file.name, file.type || "application/octet-stream", file.size);
  await cleanupExpiredDiscussionAttachments(context.workspaceId);
  const thread = await getThread(context, target, true);
  if (!thread) throw new ApiError(500, "INTERNAL_ERROR", "Discussion thread could not be created");
  const contentType = file.type || "application/octet-stream";
  const asset = await createMediaAsset(context, { name: file.name, contentType, bytes: file.bytes, scope: "TARGET", targetKey: thread.targetKey });
  try {
    const attachment = await prisma.discussionAttachment.create({
      data: {
        workspaceId: context.workspaceId,
        threadId: thread.id,
        uploadedById: context.user.id,
        fileName: file.name.trim(),
        contentType,
        size: file.size,
        storageKey: asset.id,
        mediaAssetId: asset.id
      }, include: { mediaAsset: true }
    });
    return mapAttachment(attachment);
  } catch (error) {
    await prisma.mediaAsset.delete({ where: { id: asset.id } }).catch(() => undefined);
    throw error;
  }
}

export async function createDiscussionMessage(
  context: RequestContext,
  target: DiscussionTarget,
  input: { body?: string; replyToId?: string; attachmentIds?: string[]; mediaAssetIds?: string[]; mentionUserIds?: string[] }
): Promise<DiscussionMessageDto> {
  await assertDiscussionTargetAccess(context, target, true);
  const body = (input.body ?? "").trim();
  if (body.length > 10_000) throw new ApiError(400, "VALIDATION_ERROR", "Discussion message is too long");
  const attachmentIds = [...new Set(input.attachmentIds ?? [])];
  const mediaAssetIds = [...new Set(input.mediaAssetIds ?? [])];
  const mentionUserIds = [...new Set(input.mentionUserIds ?? [])].filter((id) => id !== context.user.id);
  if (!body && !attachmentIds.length && !mediaAssetIds.length) throw new ApiError(400, "VALIDATION_ERROR", "Message text or an attachment is required");
  if (attachmentIds.length + mediaAssetIds.length > MAX_DISCUSSION_ATTACHMENTS) throw new ApiError(400, "VALIDATION_ERROR", "A message can contain at most 10 attachments");
  const thread = await getThread(context, target, true);
  if (!thread) throw new ApiError(500, "INTERNAL_ERROR", "Discussion thread could not be created");
  const [attachments, mediaAssets, mentionedUsers, replyTo] = await Promise.all([
    prisma.discussionAttachment.findMany({ where: { id: { in: attachmentIds }, workspaceId: context.workspaceId, threadId: thread.id, uploadedById: context.user.id, messageId: null } }),
    prisma.mediaAsset.findMany({ where: { id: { in: mediaAssetIds }, workspaceId: context.workspaceId, archivedAt: null } }),
    prisma.user.findMany({ where: { id: { in: mentionUserIds }, workspaceId: context.workspaceId, active: true }, select: { id: true } }),
    input.replyToId ? prisma.discussionMessage.findFirst({ where: { id: input.replyToId, workspaceId: context.workspaceId, threadId: thread.id } }) : Promise.resolve(null)
  ]);
  if (attachments.length !== attachmentIds.length) throw new ApiError(400, "VALIDATION_ERROR", "One or more attachments are invalid");
  if (mediaAssets.length !== mediaAssetIds.length) throw new ApiError(400, "VALIDATION_ERROR", "One or more media assets are invalid");
  for (const asset of mediaAssets) await assertMediaAssetAccess(context, asset, true);
  if ([...attachments, ...mediaAssets].reduce((total, item) => total + item.size, 0) > MAX_DISCUSSION_MESSAGE_ATTACHMENT_BYTES) {
    throw new ApiError(400, "VALIDATION_ERROR", "Message attachments must total 50 MB or less");
  }
  if (mentionedUsers.length !== mentionUserIds.length) throw new ApiError(400, "VALIDATION_ERROR", "One or more mentioned users are invalid");
  if (input.replyToId && !replyTo) throw new ApiError(400, "VALIDATION_ERROR", "Reply message is invalid");
  const replyRecipientId = replyTo && replyTo.authorId !== context.user.id ? replyTo.authorId : undefined;
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.discussionMessage.create({
      data: { workspaceId: context.workspaceId, threadId: thread.id, authorId: context.user.id, replyToId: replyTo?.id, body }
    });
    if (attachmentIds.length) await tx.discussionAttachment.updateMany({ where: { id: { in: attachmentIds } }, data: { messageId: created.id } });
    if (mediaAssets.length) await tx.discussionAttachment.createMany({ data: mediaAssets.map((asset) => ({ workspaceId: context.workspaceId, threadId: thread.id, messageId: created.id, uploadedById: context.user.id, mediaAssetId: asset.id, fileName: asset.name, contentType: asset.contentType, size: asset.size, storageKey: asset.id })) });
    if (mentionUserIds.length) await tx.discussionMention.createMany({ data: mentionUserIds.map((userId) => ({ workspaceId: context.workspaceId, messageId: created.id, userId })) });
    const notifications = [
      ...mentionUserIds.map((recipientId) => ({ workspaceId: context.workspaceId, recipientId, messageId: created.id, type: "mention" })),
      ...(replyRecipientId && !mentionUserIds.includes(replyRecipientId) ? [{ workspaceId: context.workspaceId, recipientId: replyRecipientId, messageId: created.id, type: "reply" }] : [])
    ];
    if (notifications.length) await tx.discussionNotification.createMany({ data: notifications, skipDuplicates: true });
    await tx.discussionThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
    await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.user.id, action: "create", entityType: "discussion_message", entityId: created.id, objectKey: target.type === "record" ? target.objectKey : undefined, summary: "Created team discussion message", details: { targetKey: thread.targetKey } } });
    return created;
  });
  const hydrated = await prisma.discussionMessage.findUniqueOrThrow({ where: { id: message.id }, include: messageInclude });
  return mapMessage(hydrated);
}

export async function updateDiscussionMessage(context: RequestContext, messageId: string, input: { body: string; mentionUserIds?: string[] }): Promise<DiscussionMessageDto> {
  const existing = await prisma.discussionMessage.findFirst({ where: { id: messageId, workspaceId: context.workspaceId }, include: { thread: true, attachments: true } });
  if (!existing) throw new ApiError(404, "NOT_FOUND", "Discussion message not found");
  await assertDiscussionTargetAccess(context, targetFromThread(existing.thread), true);
  if (existing.deletedAt) throw new ApiError(400, "BAD_REQUEST", "Deleted messages cannot be edited");
  if (existing.authorId !== context.user.id) throw new ApiError(403, "FORBIDDEN", "Only the author can edit this message");
  const body = input.body.trim();
  if (body.length > 10_000 || (!body && existing.attachments.length === 0)) throw new ApiError(400, "VALIDATION_ERROR", "Message text is invalid");
  const mentionUserIds = [...new Set(input.mentionUserIds ?? [])].filter((id) => id !== context.user.id);
  const users = await prisma.user.findMany({ where: { id: { in: mentionUserIds }, workspaceId: context.workspaceId, active: true }, select: { id: true } });
  if (users.length !== mentionUserIds.length) throw new ApiError(400, "VALIDATION_ERROR", "One or more mentioned users are invalid");
  await prisma.$transaction(async (tx) => {
    await tx.discussionMessage.update({ where: { id: existing.id }, data: { body, editedAt: new Date() } });
    await tx.discussionMention.deleteMany({ where: { messageId: existing.id } });
    await tx.discussionNotification.deleteMany({ where: { messageId: existing.id, type: "mention" } });
    if (mentionUserIds.length) {
      await tx.discussionMention.createMany({ data: mentionUserIds.map((userId) => ({ workspaceId: context.workspaceId, messageId: existing.id, userId })) });
      await tx.discussionNotification.createMany({ data: mentionUserIds.map((recipientId) => ({ workspaceId: context.workspaceId, recipientId, messageId: existing.id, type: "mention" })), skipDuplicates: true });
    }
    await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.user.id, action: "update", entityType: "discussion_message", entityId: existing.id, summary: "Updated team discussion message" } });
  });
  return mapMessage(await prisma.discussionMessage.findUniqueOrThrow({ where: { id: existing.id }, include: messageInclude }));
}

export async function deleteDiscussionMessage(context: RequestContext, messageId: string): Promise<void> {
  const existing = await prisma.discussionMessage.findFirst({ where: { id: messageId, workspaceId: context.workspaceId }, include: { thread: true, attachments: true } });
  if (!existing) throw new ApiError(404, "NOT_FOUND", "Discussion message not found");
  await assertDiscussionTargetAccess(context, targetFromThread(existing.thread), true);
  if (existing.authorId !== context.user.id && !hasPermission(context, "crm.admin")) throw new ApiError(403, "FORBIDDEN", "Only the author or an administrator can delete this message");
  const mediaAssetIds = existing.attachments.flatMap((attachment) => attachment.mediaAssetId ? [attachment.mediaAssetId] : []);
  await prisma.$transaction(async (tx) => {
    await tx.discussionAttachment.deleteMany({ where: { messageId: existing.id } });
    await tx.discussionMention.deleteMany({ where: { messageId: existing.id } });
    await tx.discussionNotification.deleteMany({ where: { messageId: existing.id } });
    await tx.discussionMessage.update({ where: { id: existing.id }, data: { body: "", deletedAt: new Date() } });
    await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.user.id, action: "delete", entityType: "discussion_message", entityId: existing.id, summary: "Deleted team discussion message" } });
  });
  for (const mediaAssetId of mediaAssetIds) {
    const asset = await prisma.mediaAsset.findUnique({ where: { id: mediaAssetId }, include: { _count: { select: { discussionAttachments: true } } } });
    if (asset?.scope === "TARGET" && asset._count.discussionAttachments === 0) {
      await prisma.mediaAsset.delete({ where: { id: asset.id } });
      if (asset.storageKey) await deleteMediaObject(asset.storageKey).catch(() => undefined);
    }
  }
}

export async function markDiscussionRead(context: RequestContext, target: DiscussionTarget): Promise<void> {
  await assertDiscussionTargetAccess(context, target);
  const thread = await getThread(context, target, false);
  if (!thread) return;
  await prisma.discussionReadState.upsert({
    where: { workspaceId_threadId_userId: { workspaceId: context.workspaceId, threadId: thread.id, userId: context.user.id } },
    create: { workspaceId: context.workspaceId, threadId: thread.id, userId: context.user.id, lastReadAt: new Date() },
    update: { lastReadAt: new Date() }
  });
}

export async function getDiscussionUnreadCounts(context: RequestContext, targets: DiscussionTarget[]): Promise<Record<string, number>> {
  const uniqueTargets = [...new Map(targets.slice(0, 100).map((target) => [buildDiscussionTargetKey(target), target])).entries()];
  for (const [, target] of uniqueTargets) await assertDiscussionTargetAccess(context, target);
  const keys = uniqueTargets.map(([key]) => key);
  const threads = await prisma.discussionThread.findMany({ where: { workspaceId: context.workspaceId, targetKey: { in: keys } }, select: { id: true, targetKey: true } });
  const states = await prisma.discussionReadState.findMany({ where: { workspaceId: context.workspaceId, userId: context.user.id, threadId: { in: threads.map((thread) => thread.id) } } });
  const stateByThread = new Map(states.map((state) => [state.threadId, state]));
  const counts: Record<string, number> = Object.fromEntries(keys.map((key) => [key, 0]));
  await Promise.all(threads.map(async (thread) => {
    const state = stateByThread.get(thread.id);
    counts[thread.targetKey] = await prisma.discussionMessage.count({
      where: { workspaceId: context.workspaceId, threadId: thread.id, authorId: { not: context.user.id }, deletedAt: null, ...(state ? { createdAt: { gt: state.lastReadAt } } : {}) }
    });
  }));
  return counts;
}

export async function listDiscussionNotifications(context: RequestContext): Promise<DiscussionNotificationDto[]> {
  const rows = await prisma.discussionNotification.findMany({
    where: { workspaceId: context.workspaceId, recipientId: context.user.id },
    include: { message: { include: { author: { select: { name: true } }, thread: true } } },
    orderBy: { createdAt: "desc" },
    take: 50
  });
  const visible: DiscussionNotificationDto[] = [];
  for (const row of rows) {
    const target = targetFromThread(row.message.thread);
    try {
      await assertDiscussionTargetAccess(context, target);
      visible.push({ id: row.id, type: row.type === "reply" ? "reply" : "mention", readAt: row.readAt?.toISOString(), createdAt: row.createdAt.toISOString(), messageId: row.messageId, preview: row.message.deletedAt ? "消息已删除" : row.message.body.slice(0, 160), authorName: row.message.author.name, target });
    } catch {
      // Access may have been revoked after the notification was created.
    }
  }
  return visible;
}

export async function markDiscussionNotificationsRead(context: RequestContext, ids?: string[]): Promise<void> {
  await prisma.discussionNotification.updateMany({
    where: { workspaceId: context.workspaceId, recipientId: context.user.id, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() }
  });
}

export async function getDiscussionAttachment(context: RequestContext, attachmentId: string) {
  const attachment = await prisma.discussionAttachment.findFirst({ where: { id: attachmentId, workspaceId: context.workspaceId }, include: { thread: true, mediaAsset: true } });
  if (!attachment || !attachment.messageId) throw new ApiError(404, "NOT_FOUND", "Discussion attachment not found");
  await assertDiscussionTargetAccess(context, targetFromThread(attachment.thread));
  return attachment;
}

export async function cleanupExpiredDiscussionAttachments(workspaceId?: string): Promise<number> {
  const expiresBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const attachments = await prisma.discussionAttachment.findMany({ where: { ...(workspaceId ? { workspaceId } : {}), messageId: null, createdAt: { lt: expiresBefore } }, take: 100 });
  if (attachments.length) {
    await prisma.discussionAttachment.deleteMany({ where: { id: { in: attachments.map((item) => item.id) } } });
    for (const item of attachments) {
      if (!item.mediaAssetId) continue;
      const asset = await prisma.mediaAsset.findUnique({ where: { id: item.mediaAssetId }, include: { _count: { select: { discussionAttachments: true } } } });
      if (asset?.scope === "TARGET" && asset._count.discussionAttachments === 0) {
        await prisma.mediaAsset.delete({ where: { id: asset.id } });
        if (asset.storageKey) await deleteMediaObject(asset.storageKey).catch(() => undefined);
      }
    }
  }
  return attachments.length;
}

function mapAttachment(attachment: { id: string; fileName: string; contentType: string; size: number; mediaAsset?: { id: string; name: string; contentType: string; size: number } | null }) {
  const asset = attachment.mediaAsset;
  return { id: attachment.id, mediaAssetId: asset?.id, fileName: asset?.name ?? attachment.fileName, contentType: asset?.contentType ?? attachment.contentType, size: asset?.size ?? attachment.size, downloadUrl: asset ? `/api/media-assets/${encodeURIComponent(asset.id)}/content` : `/api/discussions/attachments/${encodeURIComponent(attachment.id)}` };
}

function mapMessage(message: MessageWithRelations): DiscussionMessageDto {
  return {
    id: message.id,
    threadId: message.threadId,
    author: { id: message.author.id, name: message.author.name, avatarMediaAssetId: message.author.avatarMediaAssetId ?? undefined },
    body: message.deletedAt ? "" : message.body,
    parentId: message.replyToId ?? undefined,
    ...(message.replyTo ? { replyTo: { id: message.replyTo.id, authorName: message.replyTo.author.name, body: message.replyTo.deletedAt ? "" : message.replyTo.body.slice(0, 300), deleted: Boolean(message.replyTo.deletedAt) } } : {}),
    attachments: message.deletedAt ? [] : message.attachments.map(mapAttachment),
    mentionUserIds: message.mentions.map((mention) => mention.userId),
    editedAt: message.editedAt?.toISOString(),
    deletedAt: message.deletedAt?.toISOString(),
    createdAt: message.createdAt.toISOString()
  };
}
