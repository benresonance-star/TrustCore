export type TrustErrorCode =
  | "WORKSPACE_MISMATCH"
  | "INVALID_CURRENT_REVISION"
  | "INVALID_PARENT_REVISION"
  | "BASE_REVISION_CONFLICT"
  | "INVALID_REVISION_NUMBER"
  | "BLOB_HASH_INVALID"
  | "BLOB_ENCRYPTION_METADATA_INVALID"
  | "RETENTION_POLICY_INVALID"
  | "PURGE_NOT_IMPLEMENTED"
  | "RETENTION_PREVENTS_PURGE";

export class TrustInvariantError extends Error {
  readonly code: TrustErrorCode;

  constructor(code: TrustErrorCode, message: string) {
    super(message);
    this.name = "TrustInvariantError";
    this.code = code;
  }
}
