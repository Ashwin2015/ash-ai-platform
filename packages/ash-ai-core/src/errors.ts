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

function redact(value: string) {
  return value
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgres://[redacted]@")
    .replace(/Bearer [A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9._-]{20,}/g, "[redacted]");
}

export function sanitizeLogError(error: unknown) {
  const err = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const stack = typeof err.stack === "string"
    ? redact(err.stack).split("\n").slice(0, 16).join("\n")
    : undefined;
  return {
    name: typeof err.name === "string" ? err.name : undefined,
    driverCode: typeof err.code === "string" || typeof err.code === "number" ? err.code : undefined,
    constraint: typeof err.constraint === "string" ? err.constraint : undefined,
    table: typeof err.table === "string" ? err.table : undefined,
    message: redact(String(err.message || error)).slice(0, 400),
    stack,
  };
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
