export type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation_failed"
  | "conflict"
  | "rate_limited"
  | "quota_exceeded"
  | "payload_too_large"
  | "unsupported_media_type"
  | "image_quality"
  | "ai_unavailable"
  | "ai_failed"
  | "provider_unavailable"
  | "onboarding_required"
  | "internal_error";

const STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 422,
  conflict: 409,
  rate_limited: 429,
  quota_exceeded: 429,
  payload_too_large: 413,
  unsupported_media_type: 415,
  image_quality: 422,
  ai_unavailable: 503,
  ai_failed: 502,
  provider_unavailable: 503,
  onboarding_required: 409,
  internal_error: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.status = STATUS[code];
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
