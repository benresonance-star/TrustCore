import type {
  UploadScanOutcome,
  UploadScanState,
  UploadScanStatus,
} from "@trust-core/protocol";
import {
  uploadScanOutcomes,
  uploadScanStates,
} from "@trust-core/protocol";
import type { QuarantineScanStore } from "./quarantine-scan-store.js";
import { InMemoryQuarantineScanStore } from "./quarantine-scan-store.js";

export const quarantineScanStates = uploadScanStates;
export type QuarantineScanState = UploadScanState;

const transitions: Readonly<
  Record<QuarantineScanState, readonly QuarantineScanState[]>
> = {
  pending_upload: ["uploaded", "failed"],
  uploaded: ["scan_queued", "failed"],
  scan_queued: ["scanning", "failed"],
  scanning: ["accepted", "rejected", "manual_review", "failed"],
  accepted: ["promotion_pending", "failed"],
  rejected: [],
  manual_review: ["accepted", "rejected", "failed"],
  promotion_pending: ["promoted", "failed"],
  promoted: [],
  failed: ["scan_queued"],
};

export class InvalidQuarantineTransition extends Error {
  constructor(
    readonly from: QuarantineScanState,
    readonly to: QuarantineScanState,
  ) {
    super(`Invalid quarantine transition: ${from} -> ${to}`);
    this.name = "InvalidQuarantineTransition";
  }
}

export function canTransitionQuarantine(
  from: QuarantineScanState,
  to: QuarantineScanState,
): boolean {
  return transitions[from].includes(to);
}

export function transitionQuarantine(
  from: QuarantineScanState,
  to: QuarantineScanState,
): QuarantineScanState {
  if (from === to) return from;
  if (!canTransitionQuarantine(from, to)) {
    throw new InvalidQuarantineTransition(from, to);
  }
  return to;
}

export type ScanOutcome = UploadScanOutcome;
export const scanOutcomes = uploadScanOutcomes;

export interface MalwareScanner {
  submit(input: {
    scanJobId: string;
    workspaceId: string;
    uploadId: string;
    storageKey: string;
  }): Promise<void>;
}

export interface ScanCallback {
  scanJobId: string;
  workspaceId: string;
  outcome: ScanOutcome;
  engine?: string;
  authentic: boolean;
}

export interface QuarantineScanRecord {
  scanJobId: string;
  workspaceId: string;
  uploadId: string;
  storageKey: string;
  state: QuarantineScanState;
  outcome?: ScanOutcome;
  createdAt: string;
  updatedAt: string;
}

const forbiddenPublicKeys = [
  "scanJobId",
  "storageKey",
  "bucket",
  "provider",
  "engine",
  "url",
  "callback",
] as const;

export function toUploadScanStatus(
  record: QuarantineScanRecord,
): UploadScanStatus {
  const status: UploadScanStatus = {
    uploadId: record.uploadId,
    workspaceId: record.workspaceId,
    state: record.state,
    updatedAt: record.updatedAt,
  };
  if (record.outcome !== undefined) status.outcome = record.outcome;
  for (const key of forbiddenPublicKeys)
    if (Object.prototype.hasOwnProperty.call(status, key))
      throw new Error(`Public scan status must not expose ${key}`);
  return status;
}

function outcomeState(outcome: ScanOutcome): QuarantineScanState {
  switch (outcome) {
    case "clean":
      return "accepted";
    case "malicious":
      return "rejected";
    case "suspicious":
      return "manual_review";
    case "unsupported":
    case "error":
    case "timeout":
      return "failed";
    default:
      return "failed";
  }
}

export class QuarantineScanOrchestrator {
  private readonly processedCallbacks = new Set<string>();

  constructor(
    private readonly scanner: MalwareScanner,
    private readonly store: QuarantineScanStore = new InMemoryQuarantineScanStore(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async queueUploaded(input: {
    scanJobId: string;
    workspaceId: string;
    uploadId: string;
    storageKey: string;
  }): Promise<QuarantineScanRecord> {
    const existing = await this.store.getByScanJobId(
      input.workspaceId,
      input.scanJobId,
    );
    if (existing) return { ...existing };
    const now = this.clock().toISOString();
    let record: QuarantineScanRecord = {
      ...input,
      state: "uploaded",
      createdAt: now,
      updatedAt: now,
    };
    record = {
      ...record,
      state: transitionQuarantine(record.state, "scan_queued"),
      updatedAt: this.clock().toISOString(),
    };
    await this.store.save(record);
    record = {
      ...record,
      state: transitionQuarantine(record.state, "scanning"),
      updatedAt: this.clock().toISOString(),
    };
    await this.scanner.submit(input);
    await this.store.save(record);
    return { ...record };
  }

  async handleCallback(callback: ScanCallback): Promise<QuarantineScanRecord> {
    if (!callback.authentic) {
      throw new Error("Scan callback failed authenticity verification");
    }
    const record = await this.store.getByScanJobId(
      callback.workspaceId,
      callback.scanJobId,
    );
    if (!record) {
      throw new Error("Unknown scan job");
    }
    if (record.workspaceId !== callback.workspaceId) {
      throw new Error("Unknown scan job");
    }
    const callbackKey = `${callback.scanJobId}:${callback.outcome}`;
    if (this.processedCallbacks.has(callbackKey)) {
      return { ...record };
    }
    if (
      record.outcome === callback.outcome &&
      record.state === outcomeState(callback.outcome)
    ) {
      this.processedCallbacks.add(callbackKey);
      return { ...record };
    }
    if (record.state !== "scanning") {
      throw new InvalidQuarantineTransition(record.state, "accepted");
    }
    const next = outcomeState(callback.outcome);
    const updated: QuarantineScanRecord = {
      ...record,
      state: transitionQuarantine(record.state, next),
      outcome: callback.outcome,
      updatedAt: this.clock().toISOString(),
    };
    this.processedCallbacks.add(callbackKey);
    await this.store.save(updated);
    return { ...updated };
  }

  async get(
    workspaceId: string,
    scanJobId: string,
  ): Promise<QuarantineScanRecord | undefined> {
    return this.store.getByScanJobId(workspaceId, scanJobId);
  }

  async getByUploadId(
    workspaceId: string,
    uploadId: string,
  ): Promise<QuarantineScanRecord | undefined> {
    return this.store.getByUploadId(workspaceId, uploadId);
  }
}

export class FakeMalwareScanner implements MalwareScanner {
  readonly submitted: string[] = [];
  constructor(private readonly auto?: ScanOutcome) {}
  async submit(input: {
    scanJobId: string;
    workspaceId: string;
    uploadId: string;
    storageKey: string;
  }): Promise<void> {
    this.submitted.push(input.scanJobId);
    void this.auto;
  }
}
