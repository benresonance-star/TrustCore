export const storageErrorCodes = [
  "not_found",
  "access_denied",
  "conflict",
  "invalid_request",
  "throttled",
  "transient",
  "permanent",
] as const;

export type StorageErrorCode = (typeof storageErrorCodes)[number];

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  override readonly cause?: unknown;

  constructor(code: StorageErrorCode, message: string, cause?: unknown) {
    super(redactSensitive(message));
    this.name = "StorageError";
    this.code = code;
    this.cause = cause;
  }
}

export function isStorageError(error: unknown): error is StorageError {
  return error instanceof StorageError;
}

/** Strip credential-like and signed-URL material from storage error text. */
export function redactSensitive(message: string): string {
  return message
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(
      /(X-Amz-[A-Za-z0-9-]+=)[^&\s]+/gi,
      "$1[redacted]",
    )
    .replace(
      /(credential|secret|password|sessiontoken|signature)=([^&\s]+)/gi,
      "$1=[redacted]",
    );
}
