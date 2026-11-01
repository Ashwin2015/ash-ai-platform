export type PlatformErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "provider_unavailable"
  | "model_unavailable"
  | "internal_error";

export class PlatformError extends Error {
  readonly code: PlatformErrorCode;
  readonly status: number;

  constructor(
    code: PlatformErrorCode,
    message: string,
    status: number,
  ) {
    super(message);
    this.name = "PlatformError";
    this.code = code;
    this.status = status;
  }
}

export function errorPayload(error: unknown) {
  if (error instanceof PlatformError) {
    return { status: error.status, body: { error: { code: error.code, message: error.message } } };
  }
  return {
    status: 500,
    body: { error: { code: "internal_error" as const, message: "An unexpected platform error occurred." } },
  };
}
