import { createHash } from "node:crypto";
import { createIvansDiaryFixture } from "@trust-core/fixtures-ivans-diary";
import { createWeSketchFixture } from "@trust-core/fixtures-wesketch";
import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";
import {
  assembleArchiveEntries,
  ArchiveContainerError,
  ArchiveImportExecutor,
  archiveImportCheckpoints,
  assertSafeArchivePath,
  planArchiveImport,
  readTrustArchive,
  verifyArchiveEntries,
  writeTrustArchive,
  type ArchiveSource,
  type ArchiveImportAction,
  type ArchiveImportOperation,
  type ArchiveImportOperationStore,
  type ArchiveImportPlan,
  type ArchiveImportExecutionTarget,
  type ArchiveIssue,
  type ArchiveRecord,
  type ArchiveRecordKind,
} from "../src/index.js";

const encoder = new TextEncoder();

function source(): ArchiveSource {
  const fixture = createIvansDiaryFixture();
  const bytes = encoder.encode("synthetic canonical drawing bytes");
  const digest = createHash("sha256").update(bytes).digest("hex");
  return {
    exportId: "export-ivan-001",
    workspaceId: fixture.workspace.id,
    datasetIds: [fixture.dataset.id],
    createdAt: "2026-08-04T10:00:00.000Z",
    createdBy: "test-exporter",
    sourceVersion: "0.2.0-alpha.1",
    records: {
      workspaces: [
        { ...fixture.workspace, futureWorkspaceField: { retained: true } },
      ],
      datasets: [{ ...fixture.dataset }],
      resources: fixture.resources.map((record) => ({ ...record })),
      revisions: fixture.revisions.map((record) => ({ ...record })),
      relations: fixture.relations.map((record) => ({ ...record })),
      tombstones: fixture.tombstones.map((record) => ({ ...record })),
      blobs: [
        {
          id: "blob-synthetic-drawing",
          workspaceId: fixture.workspace.id,
          sha256: digest,
          byteLength: bytes.byteLength,
          mediaType: "application/octet-stream",
          futureBlobField: "preserve-me",
        },
      ],
    },
    blobs: [{ sha256: digest, byteLength: bytes.byteLength, bytes }],
  };
}

function weSketchSource(): ArchiveSource {
  const fixture = createWeSketchFixture();
  return {
    exportId: "export-wesketch-001",
    workspaceId: fixture.workspace.id,
    datasetIds: [fixture.dataset.id],
    createdAt: "2026-08-04T11:00:00.000Z",
    createdBy: "test-exporter",
    sourceVersion: "0.2.0-alpha.1",
    records: {
      workspaces: [{ ...fixture.workspace }],
      datasets: [{ ...fixture.dataset }],
      resources: fixture.resources.map((record) => ({ ...record })),
      revisions: fixture.revisions.map((record) => ({ ...record })),
      "revision-blobs": fixture.revisionBlobs.map((record) => ({ ...record })),
      blobs: fixture.blobs.map((record) => ({ ...record })),
      relations: fixture.relations.map((record) => ({ ...record })),
      tombstones: fixture.tombstones.map((record) => ({ ...record })),
    },
    blobs: fixture.blobContents.map((content) => {
      const metadata = fixture.blobs.find(
        (blob) => blob.id === content.blobObjectId,
      );
      if (!metadata)
        throw new Error("WeSketch fixture blob metadata is missing.");
      return {
        sha256: metadata.sha256,
        byteLength: metadata.byteLength,
        bytes: content.bytes,
      };
    }),
  };
}

describe("Trust Archive 0.2A logical entry set", () => {
  it("assembles deterministically and independently verifies Ivan's fixture", () => {
    const first = assembleArchiveEntries(source());
    const second = assembleArchiveEntries(source());
    expect([...first.entries]).toEqual([...second.entries]);
    const report = verifyArchiveEntries(first);
    expect(report.valid).toBe(true);
    expect(report.manifest?.recordCounts.resources).toBe(9);
    expect(report.records.workspaces?.[0]?.futureWorkspaceField).toEqual({
      retained: true,
    });
    expect(report.records.blobs?.[0]?.futureBlobField).toBe("preserve-me");
  });

  it("verifies the materially different WeSketch graph and canonical blobs", () => {
    const report = verifyArchiveEntries(
      assembleArchiveEntries(weSketchSource()),
    );
    expect(report.valid).toBe(true);
    expect(report.manifest?.blobCount).toBe(4);
    expect(report.manifest?.recordCounts["revision-blobs"]).toBeGreaterThan(0);
    expect(
      report.records.relations?.some(
        (record) => record.relationType === "produces",
      ),
    ).toBe(true);
  });

  it("detects checksum tampering and unchecked entries", () => {
    const archive = assembleArchiveEntries(source());
    const entries = new Map(archive.entries);
    entries.set("README.txt", encoder.encode("tampered"));
    entries.set("records/unexpected.jsonl", encoder.encode("{}\n"));
    const report = verifyArchiveEntries({ entries });
    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "ARCHIVE_CHECKSUM_INVALID",
        "ARCHIVE_ENTRY_UNCHECKED",
      ]),
    );
  });

  it("rejects unsafe paths and bounded-entry violations", () => {
    for (const path of ["../escape", "/absolute", "C:/drive", "a//b", "a\\b"])
      expect(() => assertSafeArchivePath(path)).toThrow();
    const archive = assembleArchiveEntries(source());
    const report = verifyArchiveEntries(archive, { maxEntryBytes: 4 });
    expect(
      report.issues.some((issue) => issue.code === "ARCHIVE_ENTRY_TOO_LARGE"),
    ).toBe(true);
  });

  it("rejects cross-workspace records and broken revision parentage", () => {
    const value = source();
    const archive = assembleArchiveEntries({
      ...value,
      records: {
        ...value.records,
        revisions: [
          ...(value.records.revisions ?? []),
          {
            id: "revision-broken",
            workspaceId: "another-workspace",
            datasetId: value.datasetIds[0],
            resourceId: "missing-resource",
            parentRevisionId: "missing-parent",
          },
        ],
      },
    });
    const report = verifyArchiveEntries(archive);
    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "ARCHIVE_WORKSPACE_MISMATCH",
        "ARCHIVE_REFERENCE_INVALID",
      ]),
    );
  });
});

describe("Trust Archive 0.2B ZIP64 container", () => {
  it("writes deterministic ZIP64 and round-trips through strict parsing", async () => {
    const logical = assembleArchiveEntries(weSketchSource());
    const first = await writeTrustArchive(logical);
    const second = await writeTrustArchive(logical);
    expect(first).toEqual(second);
    const parsed = await readTrustArchive(first);
    expect(parsed.verification.valid).toBe(true);
    expect(parsed.manifest.exportId).toBe("export-wesketch-001");

    const reader = new ZipReader(new Uint8ArrayReader(first), {
      strictness: "strict",
    });
    const entries = await reader.getEntries({ strictness: "strict" });
    expect(entries.length).toBeGreaterThan(1);
    expect(entries.every((entry) => entry.zip64)).toBe(true);
    await reader.close();
  });

  it("rejects traversal and encrypted entries before extraction", async () => {
    const traversal = await arbitraryZip(
      "../escape.txt",
      encoder.encode("bad"),
    );
    await expect(readTrustArchive(traversal)).rejects.toMatchObject({
      code: "ARCHIVE_PATH_UNSAFE",
    });

    const encrypted = await arbitraryZip(
      "secret.txt",
      encoder.encode("bad"),
      "test-password",
    );
    await expect(readTrustArchive(encrypted)).rejects.toMatchObject({
      code: "ARCHIVE_ENCRYPTION_UNSUPPORTED",
    });
  });

  it("rejects declared size and compression-ratio bombs", async () => {
    const compressed = await arbitraryZip(
      "repeated.txt",
      encoder.encode("a".repeat(100_000)),
    );
    await expect(
      readTrustArchive(compressed, { maxEntryBytes: 1_000 }),
    ).rejects.toMatchObject({ code: "ARCHIVE_ENTRY_TOO_LARGE" });
    await expect(
      readTrustArchive(compressed, {
        maxEntryBytes: 200_000,
        maxCompressionRatio: 2,
      }),
    ).rejects.toMatchObject({ code: "ARCHIVE_COMPRESSION_RATIO_EXCEEDED" });
  });

  it("returns checksum evidence rather than trusting extracted bytes", async () => {
    const logical = assembleArchiveEntries(source());
    const entries = new Map(logical.entries);
    entries.set("README.txt", encoder.encode("changed after checksums"));
    const bytes = await writeTrustArchive({ ...logical, entries });
    const parsed = await readTrustArchive(bytes);
    expect(parsed.verification.valid).toBe(false);
    expect(parsed.verification.issues).toContainEqual(
      expect.objectContaining({ code: "ARCHIVE_CHECKSUM_INVALID" }),
    );
  });

  it("normalizes parser failures to a non-sensitive container error", async () => {
    await expect(
      readTrustArchive(encoder.encode("not a zip archive")),
    ).rejects.toBeInstanceOf(ArchiveContainerError);
    await expect(
      readTrustArchive(encoder.encode("not a zip archive")),
    ).rejects.toMatchObject({ code: "ARCHIVE_CONTAINER_INVALID" });
  });
});

describe("Trust Archive 0.2C dry-run import planning", () => {
  it("produces a deterministic dependency-ordered preserve-ID plan", async () => {
    const archive = await parsed(weSketchSource());
    const request = {
      archive,
      mode: "preserve_ids" as const,
      conflictMode: "reject_on_error" as const,
      target: {},
    };
    const first = planArchiveImport(request);
    const second = planArchiveImport(request);
    expect(first.status).toBe("ready");
    expect(first.planId).toBe(second.planId);
    expect(first.actions).toEqual(second.actions);
    expect(first.actions.map((action) => action.phase)).toEqual(
      [...first.actions].map((action) => action.phase).sort((a, b) => a - b),
    );
    const attachment = first.actions.find(
      (action) => action.kind === "revision-blobs",
    );
    expect(attachment?.dependsOn).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^revisions:/),
        expect.stringMatching(/^blobs:/),
      ]),
    );
  });

  it("maps only the workspace boundary while preserving unknown fields", async () => {
    const archive = await parsed(source());
    const plan = planArchiveImport({
      archive,
      mode: "mapped_workspace",
      conflictMode: "reject_on_error",
      target: { workspaceId: "workspace-import-target" },
    });
    expect(plan.status).toBe("ready");
    expect(plan.sourceWorkspaceId).toBe("workspace-demo-ivan");
    expect(plan.targetWorkspaceId).toBe("workspace-import-target");
    const workspace = plan.actions.find(
      (action) => action.kind === "workspaces",
    );
    expect(workspace?.sourceId).toBe("workspace-demo-ivan");
    expect(workspace?.targetId).toBe("workspace-import-target");
    expect(workspace?.record?.futureWorkspaceField).toEqual({ retained: true });
    expect(
      plan.actions
        .filter((action) => action.record && "workspaceId" in action.record)
        .every(
          (action) => action.record?.workspaceId === "workspace-import-target",
        ),
    ).toBe(true);
  });

  it("classifies identical records as resumable and rejects divergent IDs", async () => {
    const archive = await parsed(source());
    const dataset = archive.verification.records.datasets?.[0];
    if (!dataset || typeof dataset.id !== "string")
      throw new Error("dataset missing");
    const resumed = planArchiveImport({
      archive,
      mode: "preserve_ids",
      conflictMode: "reject_on_error",
      target: { records: { datasets: { [dataset.id]: dataset } } },
    });
    expect(
      resumed.actions.find((action) => action.kind === "datasets")?.disposition,
    ).toBe("already_present");
    const fresh = planArchiveImport({
      archive,
      mode: "preserve_ids",
      conflictMode: "reject_on_error",
      target: {},
    });
    expect(resumed.planId).toBe(fresh.planId);

    const conflict = planArchiveImport({
      archive,
      mode: "preserve_ids",
      conflictMode: "reject_on_error",
      target: {
        records: {
          datasets: { [dataset.id]: { ...dataset, name: "different" } },
        },
      },
    });
    expect(conflict.status).toBe("rejected");
    expect(conflict.issues).toContainEqual(
      expect.objectContaining({ code: "IMPORT_ID_CONFLICT" }),
    );
    expect(conflict.counts.insert).toBe(0);
  });

  it("detects immutable schema identity conflicts", async () => {
    const value = source();
    const schema = {
      id: "schema-placeholder:app/ivans-diary/1.0.0",
      namespace: "app",
      name: "ivans-diary",
      semanticVersion: "1.0.0",
      schemaDigest: "a".repeat(64),
    };
    const archive = await parsed({
      ...value,
      records: { ...value.records, "schema-packages": [schema] },
    });
    const plan = planArchiveImport({
      archive,
      mode: "preserve_ids",
      conflictMode: "reject_on_error",
      target: {
        records: {
          "schema-packages": {
            [schema.id]: { ...schema, schemaDigest: "b".repeat(64) },
          },
        },
      },
    });
    expect(plan.status).toBe("rejected");
    expect(plan.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "IMPORT_SCHEMA_CONFLICT" }),
        expect.objectContaining({ code: "IMPORT_ID_CONFLICT" }),
      ]),
    );
  });

  it("supports report-only conflict analysis without making a writable plan", async () => {
    const archive = await parsed(source());
    const plan = planArchiveImport({
      archive,
      mode: "mapped_workspace",
      conflictMode: "report_only",
      target: {},
    });
    expect(plan.status).toBe("report_only");
    expect(plan.issues).toContainEqual(
      expect.objectContaining({ code: "IMPORT_TARGET_WORKSPACE_REQUIRED" }),
    );
    expect(plan.actions.length).toBeGreaterThan(0);
  });

  it("refuses to plan from failed verification evidence", async () => {
    const archive = await parsed(source());
    const invalid = {
      ...archive,
      verification: { ...archive.verification, valid: false },
    };
    const plan = planArchiveImport({
      archive: invalid,
      mode: "preserve_ids",
      conflictMode: "reject_on_error",
      target: {},
    });
    expect(plan.status).toBe("rejected");
    expect(plan.issues).toContainEqual(
      expect.objectContaining({ code: "IMPORT_ARCHIVE_INVALID" }),
    );
  });
});

describe("Trust Archive 0.2D resumable import execution", () => {
  it("reconstructs both application fixtures behind the same import ports", async () => {
    for (const value of [source(), weSketchSource()]) {
      const archive = await parsed(value);
      const plan = planArchiveImport({
        archive,
        mode: "preserve_ids",
        conflictMode: "reject_on_error",
        target: {},
      });
      const operations = new MemoryImportOperations();
      const target = new MemoryImportTarget();
      const result = await new ArchiveImportExecutor(
        operations,
        target,
        tickingClock(),
      ).execute({ archive, plan, requestedBy: "test-importer" });
      expect(result.operation.checkpoint).toBe("completed");
      expect(target.audit).toHaveLength(1);
      expect(target.metadataCommits).toBe(1);
      expect(target.canonicalBlobs.size).toBe(
        plan.counts.insert > 0 ? (value.blobs?.length ?? 0) : 0,
      );
      for (const action of plan.actions.filter(
        (candidate) =>
          candidate.kind !== "blob-bytes" && candidate.disposition === "insert",
      ))
        expect(
          target.records[action.kind as ArchiveRecordKind]?.get(
            action.targetId,
          ),
        ).toEqual(action.record);
    }
  });

  it("resumes with one operation after interruption at every checkpoint", async () => {
    const archive = await parsed(weSketchSource());
    const plan = planArchiveImport({
      archive,
      mode: "preserve_ids",
      conflictMode: "reject_on_error",
      target: {},
    });
    for (const checkpoint of archiveImportCheckpoints) {
      const operations = new MemoryImportOperations();
      const target = new MemoryImportTarget();
      let injected = false;
      const interrupted = new ArchiveImportExecutor(
        operations,
        target,
        tickingClock(),
        (reached) => {
          if (!injected && reached === checkpoint) {
            injected = true;
            throw new Error(`stop after ${checkpoint}`);
          }
        },
      );
      await expect(
        interrupted.execute({ archive, plan, requestedBy: "test-importer" }),
      ).rejects.toThrow(`stop after ${checkpoint}`);
      const operationId = operations.only().id;
      const resumed = await new ArchiveImportExecutor(
        operations,
        target,
        tickingClock(),
      ).execute({ archive, plan, requestedBy: "test-importer" });
      expect(resumed.operation.id).toBe(operationId);
      expect(resumed.operation.checkpoint).toBe("completed");
      expect(operations.size).toBe(1);
      expect(target.audit).toHaveLength(1);
      expect(target.metadataCommits).toBe(1);
    }
  });

  it("rejects a stale target before staging any bytes", async () => {
    const archive = await parsed(source());
    const plan = planArchiveImport({
      archive,
      mode: "preserve_ids",
      conflictMode: "reject_on_error",
      target: {},
    });
    const target = new MemoryImportTarget([
      { code: "IMPORT_ID_CONFLICT", message: "target changed" },
    ]);
    await expect(
      new ArchiveImportExecutor(new MemoryImportOperations(), target).execute({
        archive,
        plan,
        requestedBy: "test-importer",
      }),
    ).rejects.toMatchObject({ code: "IMPORT_TARGET_STALE" });
    expect(target.temporaryBlobs.size).toBe(0);
    expect(target.metadataCommits).toBe(0);
  });

  it("refuses report-only plans and archive/plan substitution", async () => {
    const archive = await parsed(source());
    const reportOnly = planArchiveImport({
      archive,
      mode: "preserve_ids",
      conflictMode: "report_only",
      target: {},
    });
    const executor = new ArchiveImportExecutor(
      new MemoryImportOperations(),
      new MemoryImportTarget(),
    );
    await expect(
      executor.execute({ archive, plan: reportOnly, requestedBy: "test" }),
    ).rejects.toMatchObject({ code: "IMPORT_PLAN_NOT_EXECUTABLE" });
    const ready = planArchiveImport({
      archive,
      mode: "preserve_ids",
      conflictMode: "reject_on_error",
      target: {},
    });
    await expect(
      executor.execute({
        archive,
        plan: { ...ready, archiveExportId: "another-export" },
        requestedBy: "test",
      }),
    ).rejects.toMatchObject({ code: "IMPORT_PLAN_ARCHIVE_MISMATCH" });
    await expect(
      executor.execute({
        archive,
        plan: {
          ...ready,
          actions: ready.actions.map((action, index) =>
            index === 0 ? { ...action, targetId: "tampered-target" } : action,
          ),
        },
        requestedBy: "test",
      }),
    ).rejects.toMatchObject({ code: "IMPORT_PLAN_ID_INVALID" });
  });
});

async function arbitraryZip(
  path: string,
  bytes: Uint8Array,
  password?: string,
): Promise<Uint8Array> {
  const output = new Uint8ArrayWriter();
  const writer = new ZipWriter(output, { zip64: true, level: 9 });
  await writer.add(path, new Uint8ArrayReader(bytes), {
    zip64: true,
    ...(password ? { password } : {}),
  });
  return writer.close(undefined, { zip64: true });
}

async function parsed(value: ArchiveSource) {
  const logical = assembleArchiveEntries(value);
  return readTrustArchive(await writeTrustArchive(logical));
}

class MemoryImportOperations implements ArchiveImportOperationStore {
  private readonly operations = new Map<string, ArchiveImportOperation>();
  get size() {
    return this.operations.size;
  }
  only() {
    const operation = [...this.operations.values()][0];
    if (!operation) throw new Error("operation missing");
    return operation;
  }
  async begin(input: {
    planId: string;
    archiveExportId: string;
    requestedBy: string;
    at: string;
  }) {
    const existing = this.operations.get(input.planId);
    if (existing) {
      if (
        existing.archiveExportId !== input.archiveExportId ||
        existing.requestedBy !== input.requestedBy
      )
        throw new Error("operation identity conflict");
      return existing;
    }
    const operation: ArchiveImportOperation = {
      id: `import-${input.planId.slice(0, 12)}`,
      ...input,
      checkpoint: "authorised",
      createdAt: input.at,
      updatedAt: input.at,
    };
    this.operations.set(input.planId, operation);
    return operation;
  }
  async advance(input: {
    operationId: string;
    planId: string;
    expected: ArchiveImportOperation["checkpoint"];
    next: ArchiveImportOperation["checkpoint"];
    at: string;
  }) {
    const current = this.operations.get(input.planId);
    if (!current || current.id !== input.operationId)
      throw new Error("operation missing");
    if (current.checkpoint === input.next) return current;
    if (current.checkpoint !== input.expected)
      throw new Error("checkpoint conflict");
    const operation: ArchiveImportOperation = {
      ...current,
      checkpoint: input.next,
      updatedAt: input.at,
      ...(input.next === "completed" ? { completedAt: input.at } : {}),
    };
    this.operations.set(input.planId, operation);
    return operation;
  }
}

class MemoryImportTarget implements ArchiveImportExecutionTarget {
  readonly temporaryBlobs = new Map<string, Uint8Array>();
  readonly canonicalBlobs = new Map<string, Uint8Array>();
  readonly records: Partial<
    Record<ArchiveRecordKind, Map<string, ArchiveRecord>>
  > = {};
  readonly audit: string[] = [];
  metadataCommits = 0;
  constructor(private readonly staleIssues: readonly ArchiveIssue[] = []) {}
  async revalidate(_plan: ArchiveImportPlan) {
    return this.staleIssues;
  }
  async stageBlob(input: {
    operationId: string;
    sha256: string;
    bytes: Uint8Array;
  }) {
    const key = `${input.operationId}:${input.sha256}`;
    const existing = this.temporaryBlobs.get(key);
    if (existing && !Buffer.from(existing).equals(Buffer.from(input.bytes)))
      throw new Error("temporary blob conflict");
    this.temporaryBlobs.set(key, Uint8Array.from(input.bytes));
  }
  async verifyStagedBlob(input: {
    operationId: string;
    sha256: string;
    byteLength: number;
  }) {
    const bytes = this.temporaryBlobs.get(
      `${input.operationId}:${input.sha256}`,
    );
    return (
      bytes?.byteLength === input.byteLength &&
      createHash("sha256").update(bytes).digest("hex") === input.sha256
    );
  }
  async commitBlob(input: { operationId: string; sha256: string }) {
    const temporary = this.temporaryBlobs.get(
      `${input.operationId}:${input.sha256}`,
    );
    if (!temporary) throw new Error("temporary blob missing");
    const existing = this.canonicalBlobs.get(input.sha256);
    if (existing && !Buffer.from(existing).equals(Buffer.from(temporary)))
      throw new Error("canonical blob conflict");
    this.canonicalBlobs.set(input.sha256, Uint8Array.from(temporary));
  }
  async commitMetadata(input: {
    operationId: string;
    plan: ArchiveImportPlan;
    actions: readonly ArchiveImportAction[];
  }) {
    const copies: Partial<
      Record<ArchiveRecordKind, Map<string, ArchiveRecord>>
    > = {};
    for (const kind of Object.keys(this.records) as ArchiveRecordKind[])
      copies[kind] = new Map(this.records[kind]);
    for (const action of input.actions) {
      if (action.kind === "blob-bytes" || !action.record) continue;
      const kind = action.kind;
      const values = copies[kind] ?? new Map<string, ArchiveRecord>();
      const existing = values.get(action.targetId);
      if (
        existing &&
        JSON.stringify(existing) !== JSON.stringify(action.record)
      )
        throw new Error("metadata conflict");
      values.set(action.targetId, action.record);
      copies[kind] = values;
    }
    for (const kind of Object.keys(copies) as ArchiveRecordKind[]) {
      const values = copies[kind];
      if (values) this.records[kind] = values;
    }
    this.metadataCommits += 1;
  }
  async appendAudit(input: { operationId: string }) {
    if (!this.audit.includes(input.operationId))
      this.audit.push(input.operationId);
  }
}

function tickingClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 7, 4, 12, 0, tick++)).toISOString();
}
