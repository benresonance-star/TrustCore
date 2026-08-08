import type { QuarantineScanRecord } from "./quarantine-scan.js";

export class QuarantineScanConflictError extends Error {
  readonly code = "QUARANTINE_SCAN_CONFLICT";

  constructor(message = "Quarantine scan identity conflict.") {
    super(message);
    this.name = "QuarantineScanConflictError";
  }
}

export interface QuarantineScanStore {
  getByUploadId(
    workspaceId: string,
    uploadId: string,
  ): Promise<QuarantineScanRecord | undefined>;
  getByScanJobId(
    workspaceId: string,
    scanJobId: string,
  ): Promise<QuarantineScanRecord | undefined>;
  save(record: QuarantineScanRecord): Promise<void>;
}

export type QuarantineScanSaveAction = "insert" | "update";

export function resolveQuarantineScanSave(
  existingByJobId: QuarantineScanRecord | undefined,
  existingByUpload: QuarantineScanRecord | undefined,
  incoming: QuarantineScanRecord,
): QuarantineScanSaveAction {
  if (existingByJobId) {
    if (
      existingByJobId.workspaceId !== incoming.workspaceId ||
      existingByJobId.uploadId !== incoming.uploadId
    ) {
      throw new QuarantineScanConflictError(
        "Scan job id is already bound to a different workspace or upload.",
      );
    }
    if (
      existingByJobId.storageKey !== incoming.storageKey ||
      existingByJobId.createdAt !== incoming.createdAt
    ) {
      throw new QuarantineScanConflictError(
        "Scan record storage key and createdAt are immutable.",
      );
    }
    return "update";
  }

  if (existingByUpload) {
    if (existingByUpload.scanJobId !== incoming.scanJobId) {
      throw new QuarantineScanConflictError(
        "Upload already has a quarantine scan with a different scan job id.",
      );
    }
    if (
      existingByUpload.storageKey !== incoming.storageKey ||
      existingByUpload.createdAt !== incoming.createdAt
    ) {
      throw new QuarantineScanConflictError(
        "Scan record storage key and createdAt are immutable.",
      );
    }
    return "update";
  }

  return "insert";
}

export class InMemoryQuarantineScanStore implements QuarantineScanStore {
  private readonly byJobId = new Map<string, QuarantineScanRecord>();

  async getByUploadId(
    workspaceId: string,
    uploadId: string,
  ): Promise<QuarantineScanRecord | undefined> {
    for (const record of this.byJobId.values())
      if (record.workspaceId === workspaceId && record.uploadId === uploadId)
        return clone(record);
    return undefined;
  }

  async getByScanJobId(
    workspaceId: string,
    scanJobId: string,
  ): Promise<QuarantineScanRecord | undefined> {
    const record = this.byJobId.get(scanJobId);
    if (!record || record.workspaceId !== workspaceId) return undefined;
    return clone(record);
  }

  async save(record: QuarantineScanRecord): Promise<void> {
    const existingByJobId = this.byJobId.get(record.scanJobId);
    const existingByUpload = await this.getByUploadId(
      record.workspaceId,
      record.uploadId,
    );
    resolveQuarantineScanSave(existingByJobId, existingByUpload, record);
    this.byJobId.set(record.scanJobId, clone(record));
  }
}

function clone(record: QuarantineScanRecord): QuarantineScanRecord {
  return { ...record };
}
