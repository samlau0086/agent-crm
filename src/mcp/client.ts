export interface CrmMcpClientConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface CrmMcpRequestOptions {
  query?: Record<string, unknown>;
  body?: unknown;
}

export interface CrmMcpErrorPayload {
  error?: string;
  code?: string;
  details?: unknown;
}

export interface CrmMcpBinaryResponse {
  contentType: string;
  filename?: string;
  size: number;
  base64: string;
}

export class CrmMcpApiError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly code?: string;
  readonly details?: unknown;
  readonly responseBody?: unknown;

  constructor(input: { status: number; method: string; path: string; message: string; code?: string; details?: unknown; responseBody?: unknown }) {
    super(input.message);
    this.name = "CrmMcpApiError";
    this.status = input.status;
    this.method = input.method;
    this.path = input.path;
    this.code = input.code;
    this.details = input.details;
    this.responseBody = input.responseBody;
  }
}

export class CrmMcpClient {
  private readonly baseUrl: URL;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: CrmMcpClientConfig) {
    if (!config.baseUrl?.trim()) {
      throw new Error("CRM_BASE_URL is required");
    }
    if (!config.apiKey?.trim()) {
      throw new Error("CRM_API_KEY is required");
    }

    this.baseUrl = new URL(config.baseUrl);
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  get<T>(path: string, options: CrmMcpRequestOptions = {}): Promise<T> {
    return this.request<T>("GET", path, options);
  }

  post<T>(path: string, body?: unknown, options: Omit<CrmMcpRequestOptions, "body"> = {}): Promise<T> {
    return this.request<T>("POST", path, { ...options, body });
  }

  patch<T>(path: string, body?: unknown, options: Omit<CrmMcpRequestOptions, "body"> = {}): Promise<T> {
    return this.request<T>("PATCH", path, { ...options, body });
  }

  delete<T>(path: string, body?: unknown, options: Omit<CrmMcpRequestOptions, "body"> = {}): Promise<T> {
    return this.request<T>("DELETE", path, { ...options, body });
  }

  async getBinary(path: string, options: Omit<CrmMcpRequestOptions, "body"> = {}): Promise<CrmMcpBinaryResponse> {
    const url = this.buildUrl(path, options.query);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        signal: controller.signal,
        headers: { accept: "application/pdf, text/csv, application/octet-stream", authorization: `Bearer ${this.apiKey}` }
      });
      if (!response.ok) {
        const responseBody = await readResponseBody(response);
        const payload = normalizeErrorPayload(responseBody);
        throw new CrmMcpApiError({ status: response.status, method: "GET", path, message: payload.error || response.statusText || "CRM request failed", code: payload.code, details: payload.details, responseBody });
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      return {
        contentType: response.headers.get("content-type") ?? "application/octet-stream",
        filename: parseContentDispositionFilename(response.headers.get("content-disposition")),
        size: bytes.length,
        base64: bytes.toString("base64")
      };
    } catch (error) {
      if (error instanceof CrmMcpApiError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new CrmMcpApiError({ status: 504, method: "GET", path, message: `CRM request timed out after ${this.timeoutMs}ms`, code: "CRM_TIMEOUT" });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async postBinary(path: string, body: unknown): Promise<CrmMcpBinaryResponse> {
    const url = this.buildUrl(path);
    const response = await this.fetchImpl(url, { method: "POST", headers: { accept: "application/pdf", authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) {
      const responseBody = await readResponseBody(response);
      const payload = normalizeErrorPayload(responseBody);
      throw new CrmMcpApiError({ status: response.status, method: "POST", path, message: payload.error || response.statusText || "CRM request failed", code: payload.code, details: payload.details, responseBody });
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    return { contentType: response.headers.get("content-type") ?? "application/pdf", filename: parseContentDispositionFilename(response.headers.get("content-disposition")), size: bytes.length, base64: bytes.toString("base64") };
  }

  private async request<T>(method: string, path: string, options: CrmMcpRequestOptions): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method,
        signal: controller.signal,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.apiKey}`,
          ...(options.body === undefined ? {} : { "content-type": "application/json" })
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });

      const responseBody = await readResponseBody(response);
      if (!response.ok) {
        const payload = normalizeErrorPayload(responseBody);
        throw new CrmMcpApiError({
          status: response.status,
          method,
          path,
          message: payload.error || response.statusText || "CRM request failed",
          code: payload.code,
          details: payload.details,
          responseBody
        });
      }

      return responseBody as T;
    } catch (error) {
      if (error instanceof CrmMcpApiError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new CrmMcpApiError({
          status: 504,
          method,
          path,
          message: `CRM request timed out after ${this.timeoutMs}ms`,
          code: "CRM_TIMEOUT"
        });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildUrl(path: string, query?: Record<string, unknown>): URL {
    const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
    const url = new URL(normalizedPath, `${this.baseUrl.href.replace(/\/$/, "")}/`);

    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null || value === "") {
        continue;
      }
      if (Array.isArray(value)) {
        if (value.length > 0) {
          url.searchParams.set(key, value.some((item) => typeof item === "object") ? JSON.stringify(value) : value.join(","));
        }
        continue;
      }
      if (typeof value === "object") {
        url.searchParams.set(key, JSON.stringify(value));
        continue;
      }
      url.searchParams.set(key, String(value));
    }

    return url;
  }
}

export function createCrmMcpClientFromEnv(env: NodeJS.ProcessEnv = process.env): CrmMcpClient {
  return new CrmMcpClient({
    baseUrl: env.CRM_BASE_URL ?? "",
    apiKey: env.CRM_API_KEY ?? "",
    timeoutMs: parsePositiveInteger(env.MCP_CRM_TIMEOUT_MS) ?? 30_000
  });
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function normalizeErrorPayload(body: unknown): CrmMcpErrorPayload {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const payload = body as CrmMcpErrorPayload;
    return {
      error: typeof payload.error === "string" ? payload.error : undefined,
      code: typeof payload.code === "string" ? payload.code : undefined,
      details: payload.details
    };
  }
  if (typeof body === "string") {
    return { error: body };
  }
  return {};
}

function parseContentDispositionFilename(value: string | null): string | undefined {
  if (!value) return undefined;
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded); } catch { return encoded; }
  }
  return value.match(/filename="?([^";]+)"?/i)?.[1];
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
