import { createHash } from "node:crypto";

export interface AuditEventBody {
  id: string;
  workspaceId: string;
  actorType: "user" | "service" | "system";
  actorId: string;
  action: string;
  subjectKind: string;
  subjectId: string;
  timestamp: string;
  requestId: string;
  correlationId: string;
  metadata: Readonly<Record<string, unknown>>;
}

export interface ChainedAuditEvent extends AuditEventBody {
  previousEventHash: string;
  eventHash: string;
}

function canonicalValue(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalValue(record[key])}`).join(",")}}`;
}

export function appendAuditEvent(body: AuditEventBody, previousEventHash = ""): ChainedAuditEvent {
  const eventHash = createHash("sha256").update(canonicalValue(body)).update(previousEventHash).digest("hex");
  return { ...body, previousEventHash, eventHash };
}

export function verifyAuditChain(events: readonly ChainedAuditEvent[]): boolean {
  let previous = "";
  for (const event of events) {
    const { previousEventHash, eventHash, ...body } = event;
    if (previousEventHash !== previous) return false;
    const expected = appendAuditEvent(body, previous).eventHash;
    if (expected !== eventHash) return false;
    previous = eventHash;
  }
  return true;
}
