export type ApiErrorCode =
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_JSON"
  | "VALIDATION_ERROR"
  | "CUSTOMER_LEVEL_IN_USE"
  | "PAYLOAD_TOO_LARGE"
  | "BAD_REQUEST"
  | "REQUEST_FAILED";

export interface ApiErrorPayload {
  error: string;
  code: ApiErrorCode | string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | string;
  readonly details?: unknown;

  constructor(status: number, code: ApiErrorCode | string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function toApiErrorPayload(error: unknown): { status: number; payload: ApiErrorPayload } {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      payload: {
        error: error.message,
        code: error.code,
        ...(error.details === undefined ? {} : { details: error.details })
      }
    };
  }

  const message = error instanceof Error ? error.message : "Request failed";
  let status = 400;
  let code: ApiErrorCode | string = "BAD_REQUEST";

  if (message === "Authentication required") {
    status = 401;
    code = "AUTH_REQUIRED";
  } else if (message.startsWith("Missing permission")) {
    status = 403;
    code = "FORBIDDEN";
  } else if (message.toLowerCase().includes("not found")) {
    status = 404;
    code = "NOT_FOUND";
  }

  return {
    status,
    payload: {
      error: message,
      code
    }
  };
}
