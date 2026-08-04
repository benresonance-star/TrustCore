import { operationStates } from "@trust-core/protocol";
import type { OperationState } from "@trust-core/protocol";

export const uploadStates = operationStates;
export type UploadState = OperationState;

const transitions: Readonly<Record<UploadState, readonly UploadState[]>> = {
  requested: ["authorised", "rejected", "failed_terminal"],
  authorised: [
    "temporary_upload_created",
    "failed_retryable",
    "failed_terminal",
  ],
  temporary_upload_created: [
    "bytes_received",
    "failed_retryable",
    "quarantined",
  ],
  bytes_received: [
    "hash_verified",
    "failed_retryable",
    "failed_terminal",
    "quarantined",
  ],
  hash_verified: [
    "immutable_object_committed",
    "failed_retryable",
    "quarantined",
  ],
  immutable_object_committed: [
    "metadata_committed",
    "failed_retryable",
    "quarantined",
  ],
  metadata_committed: ["audit_committed", "failed_retryable", "quarantined"],
  audit_committed: ["completed", "failed_retryable"],
  completed: [],
  rejected: [],
  failed_retryable: [
    "authorised",
    "temporary_upload_created",
    "bytes_received",
    "hash_verified",
    "immutable_object_committed",
    "metadata_committed",
    "audit_committed",
    "failed_terminal",
    "quarantined",
  ],
  failed_terminal: [],
  quarantined: [],
};

export class InvalidOperationTransition extends Error {
  constructor(
    readonly from: UploadState,
    readonly to: UploadState,
  ) {
    super(`Invalid upload transition: ${from} -> ${to}`);
    this.name = "InvalidOperationTransition";
  }
}

export function canTransition(from: UploadState, to: UploadState): boolean {
  return transitions[from].includes(to);
}

export function transitionUpload(
  from: UploadState,
  to: UploadState,
): UploadState {
  if (!canTransition(from, to)) throw new InvalidOperationTransition(from, to);
  return to;
}
