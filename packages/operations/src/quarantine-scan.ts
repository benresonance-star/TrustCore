export const quarantineScanStates = [
  "pending_upload",
  "uploaded",
  "scan_queued",
  "scanning",
  "accepted",
  "rejected",
  "manual_review",
  "promotion_pending",
  "promoted",
  "failed",
] as const;

export type QuarantineScanState = (typeof quarantineScanStates)[number];

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

export type ScanOutcome =
  | "clean"
  | "malicious"
  | "suspicious"
  | "unsupported"
  | "error"
  | "timeout";

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
}

export class QuarantineScanOrchestrator {
  private readonly jobs = new Map<string, QuarantineScanRecord>();
  private readonly processedCallbacks = new Set<string>();

  constructor(private readonly scanner: MalwareScanner) {}

  async queueUploaded(input: {
    scanJobId: string;
    workspaceId: string;
    uploadId: string;
    storageKey: string;
  }): Promise<QuarantineScanRecord> {
    const existing = this.jobs.get(input.scanJobId);
    if (existing) return { ...existing };
    const record: QuarantineScanRecord = {
      ...input,
      state: "uploaded",
    };
    record.state = transitionQuarantine(record.state, "scan_queued");
    this.jobs.set(input.scanJobId, record);
    record.state = transitionQuarantine(record.state, "scanning");
    await this.scanner.submit(input);
    this.jobs.set(input.scanJobId, { ...record });
    return { ...record };
  }

  async handleCallback(callback: ScanCallback): Promise<QuarantineScanRecord> {
    if (!callback.authentic) {
      throw new Error("Scan callback failed authenticity verification");
    }
    const record = this.jobs.get(callback.scanJobId);
    if (!record) {
      throw new Error("Unknown scan job");
    }
    const callbackKey = `${callback.scanJobId}:${callback.outcome}`;
    if (this.processedCallbacks.has(callbackKey)) {
      return { ...record };
    }
    if (record.state !== "scanning") {
      throw new InvalidQuarantineTransition(record.state, "accepted");
    }
    let next: QuarantineScanState;
    switch (callback.outcome) {
      case "clean":
        next = "accepted";
        break;
      case "malicious":
        next = "rejected";
        break;
      case "suspicious":
        next = "manual_review";
        break;
      case "unsupported":
      case "error":
      case "timeout":
        next = "failed";
        break;
      default:
        next = "failed";
    }
    record.state = transitionQuarantine(record.state, next);
    record.outcome = callback.outcome;
    this.processedCallbacks.add(callbackKey);
    this.jobs.set(record.scanJobId, { ...record });
    return { ...record };
  }

  get(scanJobId: string): QuarantineScanRecord | undefined {
    const record = this.jobs.get(scanJobId);
    return record ? { ...record } : undefined;
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
