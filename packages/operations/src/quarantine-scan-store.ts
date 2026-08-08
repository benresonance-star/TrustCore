import type { QuarantineScanRecord } from "./quarantine-scan.js";

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
    this.byJobId.set(record.scanJobId, clone(record));
  }
}

function clone(record: QuarantineScanRecord): QuarantineScanRecord {
  return { ...record };
}
