import { describe, expect, it } from "vitest";
import {
  createIvansDiaryFixture,
  ivansDiarySchema,
} from "@trust-core/fixtures-ivans-diary";
import {
  createWeSketchFixture,
  weSketchSchema,
} from "@trust-core/fixtures-wesketch";
import {
  PostgresArchiveImportTarget,
  PostgresContractRepository,
  PostgresOutboxStore,
  PostgresPortabilityStore,
  PostgresTrustRepository,
  PostgresVerificationCatalog,
  deterministicUuid,
  inTransaction,
  type DatabasePool,
  type QueryResult,
  type TransactionClient,
} from "../src/index.js";
import type { ObjectStorage } from "@trust-core/storage";

class RecordingClient implements TransactionClient {
  readonly calls: { text: string; values?: readonly unknown[] }[] = [];
  readonly responses = new Map<string, readonly unknown[]>();
  failOn = "";
  released = false;
  async query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>> {
    this.calls.push(values ? { text, values } : { text });
    if (this.failOn && text.includes(this.failOn))
      throw new Error("planned failure");
    for (const [fragment, rows] of this.responses)
      if (text.includes(fragment))
        return { rows: rows as Row[], rowCount: rows.length };
    return { rows: [], rowCount: 0 };
  }
  release() {
    this.released = true;
  }
}

function fakePool(client = new RecordingClient()): DatabasePool {
  return {
    query: (text, values) => client.query(text, values),
    connect: async () => client,
    end: async () => {},
  };
}

describe("PostgreSQL persistence", () => {
  it("generates stable database UUIDs for portable Trust IDs", () => {
    expect(deterministicUuid("resource-1")).toBe(
      deterministicUuid("resource-1"),
    );
    expect(deterministicUuid("resource-1")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
  it("rolls back and releases failed transactions", async () => {
    const client = new RecordingClient();
    client.failOn = "WORK";
    await expect(
      inTransaction(fakePool(client), (db) => db.query("WORK")),
    ).rejects.toThrow("planned failure");
    expect(client.calls.map((call) => call.text)).toEqual([
      "BEGIN",
      "WORK",
      "ROLLBACK",
    ]);
    expect(client.released).toBe(true);
  });
  it("seeds schema, workspace and the entire synthetic dataset atomically", async () => {
    const client = new RecordingClient();
    await new PostgresTrustRepository(fakePool(client)).seedSyntheticIvan(
      ivansDiarySchema,
      createIvansDiaryFixture(),
    );
    expect(client.calls[0]?.text).toBe("BEGIN");
    expect(client.calls.at(-1)?.text).toBe("COMMIT");
    expect(
      client.calls.filter((call) =>
        call.text.startsWith("INSERT INTO resources"),
      ),
    ).toHaveLength(9);
    expect(
      client.calls.filter((call) =>
        call.text.startsWith("INSERT INTO revisions"),
      ),
    ).toHaveLength(9);
    expect(
      client.calls.some((call) =>
        call.text.includes("set_config('trust.workspace_id'"),
      ),
    ).toBe(true);
  });
  it("generically seeds WeSketch blobs, attachments, lineage, and recovery data", async () => {
    const client = new RecordingClient(),
      fixture = createWeSketchFixture();
    await new PostgresTrustRepository(fakePool(client)).seedSyntheticFixture(
      weSketchSchema,
      fixture,
    );
    expect(client.calls[0]?.text).toBe("BEGIN");
    expect(client.calls.at(-1)?.text).toBe("COMMIT");
    expect(
      client.calls.filter((call) =>
        call.text.startsWith("INSERT INTO resources"),
      ),
    ).toHaveLength(fixture.resources.length);
    expect(
      client.calls.filter((call) =>
        call.text.startsWith("INSERT INTO revisions"),
      ),
    ).toHaveLength(fixture.revisions.length);
    expect(
      client.calls.filter((call) =>
        call.text.startsWith("INSERT INTO blob_objects"),
      ),
    ).toHaveLength(fixture.blobs.length);
    expect(
      client.calls.filter((call) =>
        call.text.startsWith("INSERT INTO revision_blobs"),
      ),
    ).toHaveLength(fixture.revisionBlobs.length);
    expect(
      client.calls.filter((call) =>
        call.text.startsWith("INSERT INTO relations"),
      ),
    ).toHaveLength(fixture.relations.length);
    expect(
      client.calls.filter((call) =>
        call.text.startsWith("INSERT INTO tombstones"),
      ),
    ).toHaveLength(1);
  });
  it("claims outbox work with scoped skip-locked leases and rejects lost ownership", async () => {
    const client = new RecordingClient(),
      store = new PostgresOutboxStore(fakePool(client)),
      workspaceId = deterministicUuid("workspace");
    expect(
      await store.claim({
        workerId: "worker",
        workspaceId,
        limit: 10,
        now: "2026-01-01T00:00:00.000Z",
        leaseUntil: "2026-01-01T00:00:30.000Z",
      }),
    ).toEqual([]);
    expect(
      client.calls.some((call) => call.text.includes("FOR UPDATE SKIP LOCKED")),
    ).toBe(true);
    await expect(
      store.complete(
        workspaceId,
        "event",
        "worker",
        "2026-01-01T00:00:01.000Z",
      ),
    ).rejects.toThrow("lease was lost");
  });
  it("scopes contract reads before querying policy, relations, and operations", async () => {
    const client = new RecordingClient(),
      repository = new PostgresContractRepository(fakePool(client)),
      workspaceId = deterministicUuid("workspace");
    await repository.listPolicyAssignments(workspaceId, "actor");
    await repository.listRelations(workspaceId, {
      subjectKind: "resource",
      subjectId: "resource",
    });
    await repository.getOperation(workspaceId, "operation");
    expect(
      client.calls.filter((call) =>
        call.text.includes("set_config('trust.workspace_id'"),
      ),
    ).toHaveLength(3);
    expect(
      client.calls.some(
        (call) =>
          call.text.includes("source_kind") &&
          call.text.includes("target_kind"),
      ),
    ).toBe(true);
  });
  it("filters active break-glass grants by principal and appends a chained audit event when used", async () => {
    const client = new RecordingClient(),
      repository = new PostgresContractRepository(fakePool(client)),
      workspaceId = deterministicUuid("workspace");
    await repository.listActiveBreakGlassGrants(
      workspaceId,
      "2026-08-04T12:00:00.000Z",
      "actor",
    );
    await repository.recordBreakGlassUse({
      workspaceId,
      principalId: "actor",
      grantId: deterministicUuid("grant"),
      action: "resource:restore",
      reason: "Urgent recovery",
      requestId: "request",
      occurredAt: "2026-08-04T12:00:00.000Z",
    });
    expect(
      client.calls.some(
        (call) =>
          call.text.includes("principal_id=$3") && call.values?.[2] === "actor",
      ),
    ).toBe(true);
    expect(
      client.calls.some(
        (call) =>
          call.text.startsWith("INSERT INTO audit_events") &&
          call.values?.includes("break_glass.used"),
      ),
    ).toBe(true);
    expect(
      client.calls.some((call) => call.text.includes("pg_advisory_xact_lock")),
    ).toBe(true);
  });
  it("persists and reads verification reports with an explicit scope", async () => {
    const client = new RecordingClient(),
      catalog = new PostgresVerificationCatalog(fakePool(client)),
      workspaceId = deterministicUuid("workspace");
    await catalog.recordRun({
      id: deterministicUuid("run"),
      workspaceId,
      level: "metadata",
      scope: { kind: "workspace", id: workspaceId },
      status: "passed",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      objectsChecked: 0,
      bytesRead: 0,
      issues: [],
    });
    await catalog.listReports(workspaceId, { kind: "dataset", id: "dataset" });
    expect(
      client.calls.some(
        (call) =>
          call.text.includes("scope_kind") &&
          call.text.startsWith("INSERT INTO verification_runs"),
      ),
    ).toBe(true);
    expect(
      client.calls.some(
        (call) =>
          call.text.includes("scope_kind=$2") &&
          call.text.includes("scope_id=$3"),
      ),
    ).toBe(true);
  });
  it("requires an explicit local gate for unsigned archive persistence", async () => {
    const store = new PostgresPortabilityStore(fakePool(), {
      allowLocalUnsignedProfile: false,
    });
    await expect(
      store.saveExport({
        id: "export",
        workspaceId: deterministicUuid("workspace"),
        datasetIds: [deterministicUuid("dataset")],
        status: "pending",
        signatureProfile: "unsigned",
        requestedBy: "actor",
        principalType: "user",
        idempotencyKey: "request",
        requestFingerprint: "a".repeat(64),
        createdAt: "2026-08-05T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "UNSIGNED_ARCHIVE_PROFILE_DISABLED" });
  });
  it("writes non-null dataset retention assignments without erasing them", async () => {
    const client = new RecordingClient();
    const workspaceId = deterministicUuid("workspace");
    const retentionPolicyId = deterministicUuid("retention-policy");
    const target = new PostgresArchiveImportTarget(
      fakePool(client),
      inertStorage(),
      workspaceId,
      "test-storage",
    );
    await target.commitMetadata({
      operationId: deterministicUuid("operation"),
      plan: {
        planId: "a".repeat(64),
        archiveExportId: "source-export",
        sourceWorkspaceId: deterministicUuid("source-workspace"),
        targetWorkspaceId: workspaceId,
        mode: "mapped_workspace",
        conflictMode: "reject_on_error",
        status: "ready",
        issues: [],
        actions: [],
        counts: { insert: 0, already_present: 0, blocked: 0 },
      },
      actions: [
        {
          index: 0,
          phase: 30,
          kind: "datasets",
          sourceId: "dataset",
          targetId: deterministicUuid("dataset"),
          disposition: "insert",
          record: {
            schemaPackageId: deterministicUuid("schema"),
            datasetType: "test",
            name: "Retained",
            status: "active",
            retentionPolicyId,
            createdBy: "actor",
            createdAt: "2026-08-05T00:00:00.000Z",
            updatedAt: "2026-08-05T00:00:00.000Z",
          },
          dependsOn: [],
        },
      ],
    });
    expect(
      client.calls.find(({ text }) => text.startsWith("INSERT INTO datasets"))
        ?.values,
    ).toContain(retentionPolicyId);
  });
  it("rolls back the complete metadata batch and appends only a native import audit event", async () => {
    const client = new RecordingClient();
    const target = new PostgresArchiveImportTarget(
      fakePool(client),
      inertStorage(),
      deterministicUuid("workspace"),
      "test-storage",
    );
    const plan = {
      planId: "a".repeat(64),
      archiveExportId: "source-export",
      sourceWorkspaceId: deterministicUuid("source-workspace"),
      targetWorkspaceId: deterministicUuid("workspace"),
      mode: "mapped_workspace" as const,
      conflictMode: "reject_on_error" as const,
      status: "ready" as const,
      issues: [],
      actions: [],
      counts: { insert: 0, already_present: 0, blocked: 0 },
    };
    await expect(
      target.commitMetadata({
        operationId: deterministicUuid("operation"),
        plan,
        actions: [
          {
            index: 0,
            phase: 30,
            kind: "datasets",
            sourceId: "dataset",
            targetId: "dataset",
            disposition: "insert",
            record: {},
            dependsOn: [],
          },
        ],
      }),
    ).rejects.toThrow("schemaPackageId");
    expect(client.calls.at(-1)?.text).toBe("ROLLBACK");

    client.responses.set("SELECT * FROM portability_import_operations", [
      {
        id: deterministicUuid("operation"),
        plan_id: plan.planId,
        archive_export_id: plan.archiveExportId,
        requested_by: "actor",
        requested_by_principal_type: "service",
        idempotency_key: "execute",
        request_fingerprint: "c".repeat(64),
        checkpoint: "metadata_committed",
        created_at: "2026-08-05T00:00:00.000Z",
        updated_at: "2026-08-05T00:00:00.000Z",
        completed_at: null,
      },
    ]);
    await target.appendAudit({
      operationId: deterministicUuid("operation"),
      plan,
      requestedBy: "actor",
      at: "2026-08-05T00:00:00.000Z",
      sourceAuditLineage: {
        mode: "source_chain",
        sourceWorkspaceId: plan.sourceWorkspaceId,
        eventCount: 1,
        firstEventHash: "b".repeat(64),
        lastEventHash: "b".repeat(64),
      },
    });
    expect(
      client.calls.findIndex(({ text }) =>
        text.includes("pg_advisory_xact_lock"),
      ),
    ).toBeLessThan(
      client.calls.findIndex(({ text }) =>
        text.includes("SELECT id FROM audit_events"),
      ),
    );
    expect(
      client.calls.some(
        ({ text, values }) =>
          text.startsWith("INSERT INTO audit_events") &&
          values?.includes("source-export") &&
          values?.includes("service"),
      ),
    ).toBe(true);
    expect(
      client.calls.some(({ text }) =>
        text.startsWith("INSERT INTO imported_archive_audit_events"),
      ),
    ).toBe(false);
  });
});

function inertStorage(): ObjectStorage {
  return {
    createTemporaryUpload: async ({ workspaceId, operationId }) => ({
      key: `${workspaceId}/${operationId}`,
      expiresAt: "2026-08-06T00:00:00.000Z",
    }),
    writeTemporary: async ({ locator, mediaType }) => ({
      key: locator.key,
      byteLength: 0,
      mediaType,
    }),
    commitImmutable: async ({
      workspaceId,
      sha256,
      byteLength,
      mediaType,
    }) => ({
      key: `${workspaceId}/${sha256}`,
      sha256,
      byteLength,
      mediaType,
    }),
    openReadStream: async () => {
      throw new Error("not used");
    },
    head: async ({ key }) => ({
      key,
      byteLength: 0,
      mediaType: "application/octet-stream",
    }),
    exists: async () => true,
    deleteTemporary: async () => {},
  };
}
