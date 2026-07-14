import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { ApiError } from "@/lib/api-error";

export const MAX_DISCUSSION_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_DISCUSSION_ATTACHMENTS = 10;
export const MAX_DISCUSSION_MESSAGE_ATTACHMENT_BYTES = 50 * 1024 * 1024;

const blockedExtensions = new Set(["bat", "cmd", "com", "dll", "exe", "html", "htm", "js", "mjs", "ps1", "sh", "svg"]);
const blockedContentTypes = new Set(["image/svg+xml", "text/html", "application/javascript", "text/javascript", "application/x-msdownload"]);
const inlineImageTypes = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

function discussionStorageRoot(): string {
  return resolve(process.env.DISCUSSION_STORAGE_DIR?.trim() || join(process.cwd(), "discussion-uploads"));
}

function discussionObjectPath(storageKey: string): string {
  const root = discussionStorageRoot();
  const target = resolve(root, ...storageKey.split("/"));
  if (target === root || !target.startsWith(`${root}${sep}`)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Discussion attachment storage key is invalid");
  }
  return target;
}

export function validateDiscussionFile(fileName: string, contentType: string, size: number): void {
  const normalizedName = fileName.trim();
  const extension = normalizedName.includes(".") ? normalizedName.split(".").pop()!.toLowerCase() : "";
  const normalizedType = contentType.toLowerCase().split(";", 1)[0];
  if (!normalizedName || normalizedName.length > 255) throw new ApiError(400, "VALIDATION_ERROR", "Attachment file name is invalid");
  if (!Number.isInteger(size) || size < 1 || size > MAX_DISCUSSION_ATTACHMENT_BYTES) {
    throw new ApiError(400, "VALIDATION_ERROR", "Each discussion attachment must be 20 MB or smaller");
  }
  if (blockedExtensions.has(extension) || blockedContentTypes.has(normalizedType)) {
    throw new ApiError(400, "VALIDATION_ERROR", "This attachment type is not allowed");
  }
}

export function isInlineDiscussionImage(contentType: string): boolean {
  return inlineImageTypes.has(contentType.toLowerCase());
}

export async function putDiscussionObject(storageKey: string, body: Uint8Array, contentType: string): Promise<void> {
  void contentType;
  const target = discussionObjectPath(storageKey);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, body, { flag: "wx" });
}

export async function getDiscussionObject(storageKey: string): Promise<Uint8Array> {
  try {
    return await readFile(discussionObjectPath(storageKey));
  } catch (error) {
    if (isMissingFileError(error)) throw new ApiError(404, "NOT_FOUND", "Attachment content not found");
    throw error;
  }
}

export async function deleteDiscussionObject(storageKey: string): Promise<void> {
  try {
    await unlink(discussionObjectPath(storageKey));
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
