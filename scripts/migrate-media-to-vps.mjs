import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const root = resolve(process.env.MEDIA_STORAGE_DIR?.trim() || join(process.cwd(), "media-uploads"));
const legacyDiscussionRoot = resolve(process.env.DISCUSSION_STORAGE_DIR?.trim() || join(process.cwd(), "discussion-uploads"));
let migrated = 0;
let skipped = 0;
let failed = 0;

try {
  let afterId;
  for (;;) {
    const assets = await prisma.mediaAsset.findMany({ where: { storageKey: null, contentBase64: { not: null }, ...(afterId ? { id: { gt: afterId } } : {}) }, orderBy: { id: "asc" }, take: 100 });
    if (!assets.length) break;
    for (const asset of assets) {
      try {
        if (!asset.contentBase64) { skipped += 1; continue; }
        const bytes = Buffer.from(asset.contentBase64, "base64");
        if (!bytes.length || bytes.length !== asset.size) throw new Error(`size mismatch: database=${asset.size}, decoded=${bytes.length}`);
        const storageKey = `${asset.workspaceId}/legacy/${asset.id}-${randomUUID()}`;
        const target = join(root, ...storageKey.split("/"));
        const temporary = `${target}.tmp`;
        await mkdir(dirname(target), { recursive: true });
        await writeFile(temporary, bytes, { flag: "wx" });
        await rename(temporary, target);
        if ((await stat(target)).size !== asset.size) throw new Error("written file size mismatch");
        await prisma.mediaAsset.update({ where: { id: asset.id }, data: { storageKey, contentBase64: null } });
        migrated += 1;
      } catch (error) {
        failed += 1;
        process.stderr.write(`[failed] ${asset.id}: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
    afterId = assets.at(-1)?.id;
  }
  let discussionAfterId;
  for (;;) {
    const attachments = await prisma.discussionAttachment.findMany({ where: { mediaAssetId: null, ...(discussionAfterId ? { id: { gt: discussionAfterId } } : {}) }, include: { thread: true }, orderBy: { id: "asc" }, take: 100 });
    if (!attachments.length) break;
    for (const attachment of attachments) {
      try {
        const oldPath = join(legacyDiscussionRoot, ...attachment.storageKey.split("/"));
        const bytes = await readFile(oldPath);
        if (bytes.length !== attachment.size) throw new Error(`discussion attachment size mismatch: database=${attachment.size}, file=${bytes.length}`);
        const storageKey = `${attachment.workspaceId}/discussion/${randomUUID()}`;
        const target = join(root, ...storageKey.split("/"));
        await mkdir(dirname(target), { recursive: true });
        await writeFile(`${target}.tmp`, bytes, { flag: "wx" });
        await rename(`${target}.tmp`, target);
        const asset = await prisma.mediaAsset.create({ data: { workspaceId: attachment.workspaceId, name: attachment.fileName, contentType: attachment.contentType, size: attachment.size, storageKey, contentBase64: null, scope: "TARGET", targetKey: attachment.thread.targetKey, createdById: attachment.uploadedById, createdAt: attachment.createdAt } });
        await prisma.discussionAttachment.update({ where: { id: attachment.id }, data: { mediaAssetId: asset.id } });
        await unlink(oldPath).catch(() => undefined);
        migrated += 1;
      } catch (error) {
        failed += 1;
        process.stderr.write(`[failed discussion attachment] ${attachment.id}: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
    discussionAfterId = attachments.at(-1)?.id;
  }
} finally {
  await prisma.$disconnect();
}

process.stdout.write(JSON.stringify({ root, migrated, skipped, failed }, null, 2) + "\n");
if (failed) process.exitCode = 1;
