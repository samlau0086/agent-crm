import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/api-error";

export const MAX_MEDIA_FILE_BYTES = 20 * 1024 * 1024;
const blockedExtensions = new Set(["bat", "cmd", "com", "dll", "exe", "html", "htm", "js", "mjs", "ps1", "sh", "svg"]);
const blockedContentTypes = new Set(["image/svg+xml", "text/html", "application/javascript", "text/javascript", "application/x-msdownload"]);

export function mediaStorageRoot(): string {
  return resolve(process.env.MEDIA_STORAGE_DIR?.trim() || process.env.DISCUSSION_STORAGE_DIR?.trim() || join(process.cwd(), "media-uploads"));
}

export function createMediaStorageKey(workspaceId: string): string {
  return `${workspaceId}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}`;
}

function mediaObjectPath(storageKey: string): string {
  const root = mediaStorageRoot();
  const target = resolve(root, ...storageKey.split("/"));
  if (target === root || !target.startsWith(`${root}${sep}`)) throw new ApiError(400, "VALIDATION_ERROR", "Media storage key is invalid");
  return target;
}

export function validateMediaFile(fileName: string, contentType: string, size: number): void {
  const normalizedName = fileName.trim();
  const extension = normalizedName.includes(".") ? normalizedName.split(".").pop()!.toLowerCase() : "";
  const normalizedType = contentType.toLowerCase().split(";", 1)[0];
  if (!normalizedName || normalizedName.length > 255) throw new ApiError(400, "VALIDATION_ERROR", "File name is invalid");
  if (!Number.isInteger(size) || size < 1 || size > MAX_MEDIA_FILE_BYTES) throw new ApiError(400, "VALIDATION_ERROR", "Each file must be 20 MB or smaller");
  if (blockedExtensions.has(extension) || blockedContentTypes.has(normalizedType)) throw new ApiError(400, "VALIDATION_ERROR", "This file type is not allowed");
}

export async function putMediaObject(storageKey: string, body: Uint8Array): Promise<void> {
  const target = mediaObjectPath(storageKey);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, body, { flag: "wx" });
  try {
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function getMediaObject(storageKey: string): Promise<Uint8Array> {
  try {
    return await readFile(mediaObjectPath(storageKey));
  } catch (error) {
    if (isMissing(error)) throw new ApiError(404, "NOT_FOUND", "Media content not found");
    throw error;
  }
}

export async function deleteMediaObject(storageKey: string): Promise<void> {
  try {
    await unlink(mediaObjectPath(storageKey));
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
