import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api-error";
import { hasPermission } from "@/lib/auth/rbac";
import type { RequestContext } from "@/lib/crm/types";
import { prisma } from "@/lib/db";
import { assertDiscussionTargetAccess, buildDiscussionTargetKey, targetFromThread } from "@/lib/discussions/target";
import {
  deleteDiscussionObject,
  MAX_DISCUSSION_ATTACHMENTS,
  MAX_DISCUSSION_MESSAGE_ATTACHMENT_BYTES,
  putDiscussionObject,
  validateDiscussionFile
} from "@/lib/discussions/storage";
import type { DiscussionMessageDto, DiscussionMessagesPage, DiscussionNotificationDto, DiscussionTarget } from "@/lib/discussions/types";

const messageInclude = {
  author: { select: { id: true, name: true, avatarMediaAssetId: true } },
  replyTo: { include: { author: { select: { name: true } } } },
  attachments: { orderBy: { createdAt: "asc" as const } },
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
  options: { before?: string; after?: string; limit?: number }
): Promise<DiscussionMessagesPage> {
  await assertDiscussionTargetAccess(context, target);
  const thread = await getThread(context, target, false);
  if (!thread) return { messages: [], unreadCount: 0 };
  const requestedLimit = options.limit ?? 50;
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(Math.trunc(requestedLimit), 100)) : 50;
  const after = options.after ? decodeDiscussionCursor(options.after) : undefined;
  const before = options.before ? decodeDiscussionCursor(options.before) : undefined;
  if (after && before) throw new ApiError(400, "VALIDATION_ERROR", "Use either before or after cursor");
  const rows = await prisma.discussionMessage.findMany({
    where: { workspaceId: context.workspaceId, threadId: thread.id, ...(after ? cursorWhere(after, "after") : before ? cursorWhere(before, "before") : {}) },
    include: messageInclude,
    orderBy: [{ createdAt: after ? "asc" : "desc" }, { id: after ? "asc" : "desc" }],
    take: after ? limit : limit + 1
  });
  const hasMore = !after && rows.length > limit;
  if (hasMore) rows.pop();
  if (!after) rows.reverse();
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
  return {
    messages: rows.map(mapMessage),
    unreadCount,
    ...(hasMore && rows[0] ? { nextBefore: encodeDiscussionCursor(rows[0]) } : {}),
    ...(rows.at(-1) ? { latestCursor: encodeDiscussionCursor(rows.at(-1)!) } : {})
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
  const storageKey = `${context.workspaceId}/${thread.id}/${randomUUID()}`;
  const contentType = file.type || "application/octet-stream";
  await putDiscussionObject(storageKey, file.bytes, contentType);
  try {
    const attachment = await prisma.discussionAttachment.create({
      data: {
        workspaceId: context.workspaceId,
        threadId: thread.id,
        uploadedById: context.user.id,
        fileName: file.name.trim(),
        contentType,
        size: file.size,
        storageKey
      }
    });
    return mapAttachment(attachment);
  } catch (error) {
    await deleteDiscussionObject(storageKey).catch(() => undefined);
    throw error;
  }
}

export async function createDiscussionMessage(
  context: RequestContext,
  target: DiscussionTarget,
  input: { body?: string; replyToId?: string; attachmentIds?: string[]; mentionUserIds?: string[] }
): Promise<DiscussionMessageDto> {
  await assertDiscussionTargetAccess(context, target, true);
  const body = (input.body ?? "").trim();
  if (body.length > 10_000) throw new ApiError(400, "VALIDATION_ERROR", "Discussion message is too long");
  const attachmentIds = [...new Set(input.attachmentIds ?? [])];
  const mentionUserIds = [...new Set(input.mentionUserIds ?? [])].filter((id) => id !== context.user.id);
  if (!body && !attachmentIds.length) throw new ApiError(400, "VALIDATION_ERROR", "Message text or an attachment is required");
  if (attachmentIds.length > MAX_DISCUSSION_ATTACHMENTS) throw new ApiError(400, "VALIDATION_ERROR", "A message can contain at most 10 attachments");
  const thread = await getThread(context, target, true);
  if (!thread) throw new ApiError(500, "INTERNAL_ERROR", "Discussion thread could not be created");
  const [attachments, mentionedUsers, replyTo] = await Promise.all([
    prisma.discussionAttachment.findMany({ where: { id: { in: attachmentIds }, workspaceId: context.workspaceId, threadId: thread.id, uploadedById: context.user.id, messageId: null } }),
    prisma.user.findMany({ where: { id: { in: mentionUserIds }, workspaceId: context.workspaceId, active: true }, select: { id: true } }),
    input.replyToId ? prisma.discussionMessage.findFirst({ where: { id: input.replyToId, workspaceId: context.workspaceId, threadId: thread.id } }) : Promise.resolve(null)
  ]);
  if (attachments.length !== attachmentIds.length) throw new ApiError(400, "VALIDATION_ERROR", "One or more attachments are invalid");
  if (attachments.reduce((total, item) => total + item.size, 0) > MAX_DISCUSSION_MESSAGE_ATTACHMENT_BYTES) {
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
  await Promise.all(existing.attachments.map((attachment) => deleteDiscussionObject(attachment.storageKey).catch(() => undefined)));
  await prisma.$transaction(async (tx) => {
    await tx.discussionAttachment.deleteMany({ where: { messageId: existing.id } });
    await tx.discussionMention.deleteMany({ where: { messageId: existing.id } });
    await tx.discussionNotification.deleteMany({ where: { messageId: existing.id } });
    await tx.discussionMessage.update({ where: { id: existing.id }, data: { body: "", deletedAt: new Date() } });
    await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.user.id, action: "delete", entityType: "discussion_message", entityId: existing.id, summary: "Deleted team discussion message" } });
  });
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
  const attachment = await prisma.discussionAttachment.findFirst({ where: { id: attachmentId, workspaceId: context.workspaceId }, include: { thread: true } });
  if (!attachment || !attachment.messageId) throw new ApiError(404, "NOT_FOUND", "Discussion attachment not found");
  await assertDiscussionTargetAccess(context, targetFromThread(attachment.thread));
  return attachment;
}

export async function cleanupExpiredDiscussionAttachments(workspaceId?: string): Promise<number> {
  const expiresBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const attachments = await prisma.discussionAttachment.findMany({ where: { ...(workspaceId ? { workspaceId } : {}), messageId: null, createdAt: { lt: expiresBefore } }, take: 100 });
  await Promise.all(attachments.map((attachment) => deleteDiscussionObject(attachment.storageKey).catch(() => undefined)));
  if (attachments.length) await prisma.discussionAttachment.deleteMany({ where: { id: { in: attachments.map((item) => item.id) } } });
  return attachments.length;
}

function mapAttachment(attachment: { id: string; fileName: string; contentType: string; size: number }) {
  return { id: attachment.id, fileName: attachment.fileName, contentType: attachment.contentType, size: attachment.size, downloadUrl: `/api/discussions/attachments/${encodeURIComponent(attachment.id)}` };
}

function mapMessage(message: MessageWithRelations): DiscussionMessageDto {
  return {
    id: message.id,
    threadId: message.threadId,
    author: { id: message.author.id, name: message.author.name, avatarMediaAssetId: message.author.avatarMediaAssetId ?? undefined },
    body: message.deletedAt ? "" : message.body,
    ...(message.replyTo ? { replyTo: { id: message.replyTo.id, authorName: message.replyTo.author.name, body: message.replyTo.deletedAt ? "" : message.replyTo.body.slice(0, 300), deleted: Boolean(message.replyTo.deletedAt) } } : {}),
    attachments: message.deletedAt ? [] : message.attachments.map(mapAttachment),
    mentionUserIds: message.mentions.map((mention) => mention.userId),
    editedAt: message.editedAt?.toISOString(),
    deletedAt: message.deletedAt?.toISOString(),
    createdAt: message.createdAt.toISOString()
  };
}
