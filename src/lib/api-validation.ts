import type { ZodType } from "zod";
import { ApiError } from "@/lib/api-error";

export const DEFAULT_JSON_BODY_LIMIT_BYTES = 5 * 1024 * 1024;
export const DEFAULT_FORM_BODY_LIMIT_BYTES = 256 * 1024;

type BodyParseOptions = {
  maxBytes?: number;
};

export async function parseJsonBody<T>(request: Request, schema?: ZodType<T>, options: BodyParseOptions = {}): Promise<T> {
  const maxBytes = options.maxBytes ?? DEFAULT_JSON_BODY_LIMIT_BYTES;
  assertContentLengthWithinLimit(request, maxBytes);

  let text: string;
  try {
    text = await request.text();
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body must be valid JSON");
  }

  if (byteLength(text) > maxBytes) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", `Request body must be ${maxBytes} bytes or smaller`);
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body must be valid JSON");
  }

  if (!schema) {
    return body as T;
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Request body failed validation", result.error.flatten());
  }

  return result.data;
}

export async function parseFormBody(request: Request, options: BodyParseOptions = {}): Promise<FormData> {
  const maxBytes = options.maxBytes ?? DEFAULT_FORM_BODY_LIMIT_BYTES;
  assertContentLengthWithinLimit(request, maxBytes);

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded") && !contentType.includes("multipart/form-data")) {
    throw new ApiError(400, "BAD_REQUEST", "Request body must be form data");
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    let text: string;
    try {
      text = await request.text();
    } catch {
      throw new ApiError(400, "BAD_REQUEST", "Request body must be form data");
    }

    if (byteLength(text) > maxBytes) {
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", `Request body must be ${maxBytes} bytes or smaller`);
    }

    const formData = new FormData();
    for (const [key, value] of new URLSearchParams(text)) {
      formData.append(key, value);
    }
    return formData;
  }

  try {
    return await request.formData();
  } catch {
    throw new ApiError(400, "BAD_REQUEST", "Request body must be form data");
  }
}

function assertContentLengthWithinLimit(request: Request, maxBytes: number): void {
  const contentLength = request.headers.get("content-length");
  if (!contentLength) {
    return;
  }

  const parsed = Number(contentLength);
  if (Number.isFinite(parsed) && parsed > maxBytes) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", `Request body must be ${maxBytes} bytes or smaller`);
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
