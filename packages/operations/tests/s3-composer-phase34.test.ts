import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { MemoryObjectStorage, temporaryObjectKey } from "@trust-core/storage";
import {
  FakeMalwareScanner,
  FakeTransferSigner,
  GrantDeniedError,
  InMemoryQuarantineScanStore,
  QuarantineScanOrchestrator,
  TransferGrantService,
  promoteQuarantineObject,
  transitionQuarantine,
} from "../src/index.js";

const actor = {
  id: "user_1",
  displayName: "User",
  roles: ["editor" as const],
  workspaceIds: ["workspace_a"],
};

function policyBase(workspaceId: string) {
  return {
    principal: {
      id: actor.id,
      type: "user" as const,
      roles: ["editor"],
      workspaceIds: [workspaceId],
    },
    scope: { workspaceId },
    assignments: [
      {
        id: "assign_1",
        workspaceId,
        principalType: "user" as const,
        principalId: actor.id,
        role: "editor",
        scopeKind: "workspace" as const,
        scopeId: workspaceId,
      },
    ],
  };
}

describe("TransferGrantService", () => {
  it("issues upload grants after policy allow and redacts urls from signer failures", async () => {
    const audits: string[] = [];
    const signer = new FakeTransferSigner();
    const service = new TransferGrantService(
      { maxTtlSeconds: 60 },
      signer,
      {
        async record(input) {
          audits.push(input.action);
        },
      },
    );
    const grant = await service.issue({
      actor,
      workspaceId: "workspace_a",
      operation: "upload",
      target: {
        workspaceId: "workspace_a",
        objectId: "upload_1",
        storageKey: temporaryObjectKey("workspace_a", "upload_1"),
        downloadable: false,
        mediaType: "text/plain",
      },
      requestedTtlSeconds: 120,
      requestId: "req_1",
      correlationId: "corr_1",
      policyInput: policyBase("workspace_a"),
    });
    expect(grant.transfer.method).toBe("PUT");
    expect(grant.expiresAt).toBeTruthy();
    expect(audits).toContain("transfer_grant.issued.upload");
    expect(signer.signed[0]).toContain("upload:");
  });

  it("denies download for quarantined objects and cross-workspace targets", async () => {
    const service = new TransferGrantService(
      { maxTtlSeconds: 60 },
      new FakeTransferSigner(),
      { async record() {} },
    );
    await expect(
      service.issue({
        actor,
        workspaceId: "workspace_a",
        operation: "download",
        target: {
          workspaceId: "workspace_b",
          objectId: "asset_1",
          storageKey: "workspaces/workspace_b/objects/ab/" + "a".repeat(64),
          downloadable: true,
        },
        requestedTtlSeconds: 30,
        requestId: "req_2",
        correlationId: "corr_2",
        policyInput: policyBase("workspace_a"),
      }),
    ).rejects.toBeInstanceOf(GrantDeniedError);

    await expect(
      service.issue({
        actor,
        workspaceId: "workspace_a",
        operation: "download",
        target: {
          workspaceId: "workspace_a",
          objectId: "asset_2",
          storageKey: temporaryObjectKey("workspace_a", "q"),
          downloadable: false,
          quarantineState: "scanning",
        },
        requestedTtlSeconds: 30,
        requestId: "req_3",
        correlationId: "corr_3",
        policyInput: policyBase("workspace_a"),
      }),
    ).rejects.toMatchObject({ code: "not_downloadable" });
  });

  it("rejects object-key shaped identifiers", async () => {
    const service = new TransferGrantService(
      { maxTtlSeconds: 60 },
      new FakeTransferSigner(),
      { async record() {} },
    );
    await expect(
      service.issue({
        actor,
        workspaceId: "workspace_a",
        operation: "upload",
        target: {
          workspaceId: "workspace_a",
          objectId: "workspaces/workspace_a/temporary/x",
          storageKey: temporaryObjectKey("workspace_a", "x"),
          downloadable: false,
        },
        requestedTtlSeconds: 30,
        requestId: "req_4",
        correlationId: "corr_4",
        policyInput: policyBase("workspace_a"),
      }),
    ).rejects.toMatchObject({ code: "invalid_object" });
  });
});

describe("QuarantineScanOrchestrator", () => {
  it("orchestrates clean and malicious outcomes idempotently", async () => {
    const scanner = new FakeMalwareScanner();
    const orchestrator = new QuarantineScanOrchestrator(scanner);
    const queued = await orchestrator.queueUploaded({
      scanJobId: "scan_1",
      workspaceId: "workspace_a",
      uploadId: "upload_1",
      storageKey: temporaryObjectKey("workspace_a", "upload_1"),
    });
    expect(queued.state).toBe("scanning");
    const clean = await orchestrator.handleCallback({
      scanJobId: "scan_1",
      workspaceId: "workspace_a",
      outcome: "clean",
      authentic: true,
    });
    expect(clean.state).toBe("accepted");
    const duplicate = await orchestrator.handleCallback({
      scanJobId: "scan_1",
      workspaceId: "workspace_a",
      outcome: "clean",
      authentic: true,
    });
    expect(duplicate.state).toBe("accepted");
    expect(duplicate.updatedAt).toBe(clean.updatedAt);
    await expect(
      orchestrator.handleCallback({
        scanJobId: "scan_1",
        workspaceId: "workspace_a",
        outcome: "malicious",
        authentic: false,
      }),
    ).rejects.toThrow(/authenticity/);
  });

  it("writes transitions through the provider-neutral store", async () => {
    let now = Date.parse("2026-08-08T10:00:00.000Z");
    const store = new InMemoryQuarantineScanStore();
    const orchestrator = new QuarantineScanOrchestrator(
      new FakeMalwareScanner(),
      store,
      () => new Date(now),
    );
    await orchestrator.queueUploaded({
      scanJobId: "scan_store",
      workspaceId: "workspace_a",
      uploadId: "upload_store",
      storageKey: temporaryObjectKey("workspace_a", "upload_store"),
    });
    const scanning = await store.getByUploadId("workspace_a", "upload_store");
    expect(scanning?.state).toBe("scanning");
    const scanningUpdatedAt = scanning!.updatedAt;
    now += 60_000;
    const accepted = await orchestrator.handleCallback({
      scanJobId: "scan_store",
      workspaceId: "workspace_a",
      outcome: "clean",
      authentic: true,
    });
    expect(accepted.updatedAt).not.toBe(scanningUpdatedAt);
    now += 60_000;
    const duplicate = await orchestrator.handleCallback({
      scanJobId: "scan_store",
      workspaceId: "workspace_a",
      outcome: "clean",
      authentic: true,
    });
    expect(duplicate.updatedAt).toBe(accepted.updatedAt);
    expect(
      await store.getByUploadId("workspace_b", "upload_store"),
    ).toBeUndefined();
  });

  it("rejects illegal transitions", () => {
    expect(() => transitionQuarantine("uploaded", "promoted")).toThrow(
      /Invalid quarantine transition/,
    );
  });
});

describe("promoteQuarantineObject", () => {
  it("promotes accepted quarantine bytes idempotently", async () => {
    const storage = new MemoryObjectStorage();
    const body = Buffer.from("promote-me");
    const sha256 = createHash("sha256").update(body).digest("hex");
    const temporary = await storage.createTemporaryUpload({
      workspaceId: "workspace_a",
      operationId: "promote_1",
    });
    await storage.writeTemporary({
      locator: temporary,
      body: Readable.from(body),
      mediaType: "text/plain",
    });
    const first = await promoteQuarantineObject(storage, {
      workspaceId: "workspace_a",
      quarantine: temporary,
      canonical: {
        key: `workspaces/workspace_a/objects/${sha256.slice(0, 2)}/${sha256}`,
      },
      sha256,
      byteLength: body.byteLength,
      mediaType: "text/plain",
      scanState: "accepted",
    });
    expect(first.sha256).toBe(sha256);
    const second = await promoteQuarantineObject(storage, {
      workspaceId: "workspace_a",
      quarantine: temporary,
      canonical: first,
      sha256,
      byteLength: body.byteLength,
      mediaType: "text/plain",
      scanState: "accepted",
    });
    expect(second.key).toBe(first.key);
    await expect(
      promoteQuarantineObject(storage, {
        workspaceId: "workspace_a",
        quarantine: temporary,
        canonical: first,
        sha256,
        byteLength: body.byteLength,
        mediaType: "text/plain",
        scanState: "uploaded",
      }),
    ).rejects.toThrow(/accepted/);
  });
});
