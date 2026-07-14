import { prisma } from "@/lib/db";
import { deleteDiscussionObject } from "@/lib/discussions/storage";

export async function purgeDiscussionTargets(workspaceId: string, targetKeys: string[]): Promise<void> {
  if (!targetKeys.length) return;
  const threads = await prisma.discussionThread.findMany({
    where: { workspaceId, targetKey: { in: targetKeys } },
    include: { attachments: { select: { storageKey: true } } }
  });
  await Promise.all(threads.flatMap((thread) => thread.attachments.map((attachment) => deleteDiscussionObject(attachment.storageKey).catch(() => undefined))));
  await prisma.discussionThread.deleteMany({ where: { workspaceId, id: { in: threads.map((thread) => thread.id) } } });
}
