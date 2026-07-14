import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { ApiError } from "@/lib/api-error";

export const MAX_DISCUSSION_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_DISCUSSION_ATTACHMENTS = 10;
export const MAX_DISCUSSION_MESSAGE_ATTACHMENT_BYTES = 50 * 1024 * 1024;

const blockedExtensions = new Set(["bat", "cmd", "com", "dll", "exe", "html", "htm", "js", "mjs", "ps1", "sh", "svg"]);
const blockedContentTypes = new Set(["image/svg+xml", "text/html", "application/javascript", "text/javascript", "application/x-msdownload"]);
const inlineImageTypes = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

interface StorageConfig {
  bucket: string;
  client: S3Client;
}

let cachedStorage: StorageConfig | undefined;

function discussionStorage(): StorageConfig {
  if (cachedStorage) return cachedStorage;
  const endpoint = process.env.DISCUSSION_STORAGE_ENDPOINT?.trim();
  const bucket = process.env.DISCUSSION_STORAGE_BUCKET?.trim();
  const accessKeyId = process.env.DISCUSSION_STORAGE_ACCESS_KEY?.trim();
  const secretAccessKey = process.env.DISCUSSION_STORAGE_SECRET_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new ApiError(503, "CONFIGURATION_ERROR", "Discussion object storage is not configured");
  }
  cachedStorage = {
    bucket,
    client: new S3Client({
      endpoint,
      region: process.env.DISCUSSION_STORAGE_REGION?.trim() || "us-east-1",
      forcePathStyle: process.env.DISCUSSION_STORAGE_FORCE_PATH_STYLE !== "false",
      credentials: { accessKeyId, secretAccessKey }
    })
  };
  return cachedStorage;
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
  const storage = discussionStorage();
  await storage.client.send(new PutObjectCommand({ Bucket: storage.bucket, Key: storageKey, Body: body, ContentType: contentType }));
}

export async function getDiscussionObject(storageKey: string): Promise<Uint8Array> {
  const storage = discussionStorage();
  const result = await storage.client.send(new GetObjectCommand({ Bucket: storage.bucket, Key: storageKey }));
  if (!result.Body) throw new ApiError(404, "NOT_FOUND", "Attachment content not found");
  return result.Body.transformToByteArray();
}

export async function deleteDiscussionObject(storageKey: string): Promise<void> {
  const storage = discussionStorage();
  await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: storageKey }));
}
