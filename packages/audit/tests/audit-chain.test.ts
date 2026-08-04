import { describe, expect, it } from "vitest";
import { appendAuditEvent, verifyAuditChain } from "../src/index.js";

const base = {
  workspaceId: "workspace-1", actorType: "user" as const, actorId: "actor-1",
  action: "resource.created", subjectKind: "resource", subjectId: "resource-1",
  timestamp: "2026-08-03T00:00:00.000Z", requestId: "request-1", correlationId: "correlation-1", metadata: {},
};

describe("audit chain", () => {
  it("detects tampering", () => {
    const first = appendAuditEvent({ id: "event-1", ...base });
    const second = appendAuditEvent({ id: "event-2", ...base, action: "revision.created" }, first.eventHash);
    expect(verifyAuditChain([first, second])).toBe(true);
    expect(verifyAuditChain([first, { ...second, action: "purge.executed" }])).toBe(false);
  });
});
