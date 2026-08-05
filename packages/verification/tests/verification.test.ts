import { Readable } from "node:stream";
import { appendAuditEvent } from "@trust-core/audit";
import type { BlobObject, Dataset, Resource, Revision } from "@trust-core/core";
import type { VerificationScope } from "@trust-core/protocol";
import type { SchemaPackageManifest } from "@trust-core/schema-registry";
import type {
  ObjectLocator,
  ObjectMetadata,
  ObjectStorage,
  StoredObject,
  TemporaryObject,
} from "@trust-core/storage";
import { describe, expect, it } from "vitest";
import {
  BlobVerificationService,
  StructuralVerificationService,
  type StructuralVerificationCatalog,
  type VerificationCatalog,
  type VerificationRun,
  type VerificationSnapshot,
} from "../src/index.js";

class Storage implements ObjectStorage {
  bytes = Buffer.from("trusted bytes");
  missing = false;
  async createTemporaryUpload(): Promise<TemporaryObject> {
    throw new Error("unused");
  }
  async writeTemporary(): Promise<ObjectMetadata> {
    throw new Error("unused");
  }
  async commitImmutable(): Promise<StoredObject> {
    throw new Error("unused");
  }
  async openReadStream() {
    if (this.missing) throw new Error("missing");
    return Readable.from(this.bytes);
  }
  async head(input: ObjectLocator) {
    if (this.missing) throw new Error("missing");
    return {
      key: input.key,
      byteLength: this.bytes.length,
      mediaType: "text/plain",
    };
  }
  async exists() {
    return !this.missing;
  }
  async deleteTemporary() {}
}

const blob: BlobObject = {
  id: "blob",
  workspaceId: "workspace",
  sha256: "6acd7c3c149b0fdbc542a20bb7ece8164ebf4b78148c3f65c2fddf208cc74e35",
  byteLength: 13,
  mediaType: "text/plain",
  storageProvider: "memory",
  storageKey: "workspace/objects/blob",
  encryptionState: "provider_managed",
  encryptionKeyRef: null,
  verificationState: "pending",
  createdAt: "2026-01-01T00:00:00.000Z",
};

class Catalog implements VerificationCatalog {
  readonly runs: VerificationRun[] = [];
  state: BlobObject["verificationState"] = "pending";
  workspacePresent = true;
  constructor(readonly blobs: readonly BlobObject[]) {}
  async workspaceExists() {
    return this.workspacePresent;
  }
  async listBlobs() {
    return this.blobs;
  }
  async recordRun(run: VerificationRun) {
    this.runs.push(run);
  }
  async setBlobVerification(
    _workspaceId: string,
    _blobId: string,
    state: BlobObject["verificationState"],
  ) {
    this.state = state;
  }
  async getReport(_workspaceId: string, reportId: string) {
    return this.runs.find(({ id }) => id === reportId);
  }
  async listReports(_workspaceId: string, scope?: VerificationScope) {
    return scope
      ? this.runs.filter(
          (run) => run.scope.kind === scope.kind && run.scope.id === scope.id,
        )
      : this.runs;
  }
}

describe("full-byte verification", () => {
  it("distinguishes metadata checks from streaming hash verification", async () => {
    const storage = new Storage();
    const catalog = new Catalog([blob]);
    const service = new BlobVerificationService(
      storage,
      catalog,
      () => "2026-01-02T00:00:00.000Z",
      () => "run",
    );
    const metadata = await service.run({
      workspaceId: "workspace",
      level: "metadata",
    });
    expect(metadata.bytesRead).toBe(0);
    expect(metadata.status).toBe("passed");
    const full = await service.run({
      workspaceId: "workspace",
      level: "full_blob",
    });
    expect(full.bytesRead).toBe(13);
    expect(full.status).toBe("passed");
    expect(catalog.state).toBe("verified");
  });

  it("reports corruption and missing canonical objects as critical failures", async () => {
    const storage = new Storage();
    storage.bytes = Buffer.from("tampered bytes");
    const catalog = new Catalog([blob]);
    const service = new BlobVerificationService(storage, catalog);
    const corrupt = await service.run({
      workspaceId: "workspace",
      level: "full_blob",
    });
    expect(corrupt.status).toBe("failed");
    expect(corrupt.issues.map(({ code }) => code)).toContain(
      "FULL_HASH_MISMATCH",
    );
    storage.missing = true;
    const missing = await service.run({
      workspaceId: "workspace",
      level: "full_blob",
    });
    expect(missing.issues[0]?.code).toBe("BLOB_MISSING_OR_INACCESSIBLE");
    expect(catalog.state).toBe("failed");
  });

  it("does not pass an empty or nonexistent workspace vacuously", async () => {
    const catalog = new Catalog([]);
    const service = new BlobVerificationService(new Storage(), catalog);
    const empty = await service.run({
      workspaceId: "workspace",
      level: "metadata",
    });
    expect(empty.status).toBe("degraded");
    expect(empty.objectsChecked).toBe(0);
    expect(empty.issues.map(({ code }) => code)).toEqual([
      "NO_OBJECTS_CHECKED",
    ]);

    catalog.workspacePresent = false;
    await expect(
      service.run({ workspaceId: "missing", level: "full_blob" }),
    ).rejects.toThrow("Verification workspace was not found.");
    expect(catalog.runs).toHaveLength(1);
  });
});

const manifest: SchemaPackageManifest = {
  namespace: "test",
  name: "records",
  version: "1.0.0",
  title: "Records",
  description: "Verification test schema",
  classification: "application",
  resourceTypes: [
    {
      name: "record",
      description: "Record",
      fields: { title: { kind: "string", required: true } },
      additionalFields: "reject",
    },
  ],
  relationships: [],
  compatibleArchiveFormat: "trust-archive/1",
};
const dataset: Dataset = {
  id: "dataset",
  workspaceId: "workspace",
  schemaPackageId: "schema",
  datasetType: "records",
  name: "Records",
  status: "active",
  retentionPolicyId: null,
  createdBy: "actor",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const resource: Resource = {
  id: "resource",
  workspaceId: "workspace",
  datasetId: "dataset",
  resourceType: "record",
  title: "Record",
  status: "active",
  currentRevisionId: "revision",
  createdBy: "actor",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const revision: Revision = {
  id: "revision",
  workspaceId: "workspace",
  datasetId: "dataset",
  resourceId: "resource",
  revisionNumber: 1,
  parentRevisionId: null,
  mergeParentRevisionIds: [],
  schemaPackageId: "schema",
  schemaVersion: "1.0.0",
  canonicalPayload: { title: "Verified" },
  canonicalPayloadHash: "c".repeat(64),
  createdBy: "actor",
  createdOnDeviceId: null,
  source: "user",
  changeNote: null,
  restoredFromRevisionId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

class StructuralCatalog
  extends Catalog
  implements StructuralVerificationCatalog
{
  constructor(readonly snapshot: VerificationSnapshot) {
    super(snapshot.blobs);
  }
  async loadSnapshot() {
    return this.snapshot;
  }
}

function snapshot(
  overrides: Partial<VerificationSnapshot> = {},
): VerificationSnapshot {
  const audit = appendAuditEvent({
    id: "audit",
    workspaceId: "workspace",
    actorType: "user",
    actorId: "actor",
    action: "resource.created",
    subjectKind: "resource",
    subjectId: "resource",
    timestamp: "2026-01-01T00:00:00.000Z",
    requestId: "request",
    correlationId: "correlation",
    metadata: {},
  });
  return {
    workspaceExists: true,
    datasets: [dataset],
    resources: [resource],
    revisions: [revision],
    blobs: [blob],
    revisionBlobs: [
      {
        id: "attachment",
        workspaceId: "workspace",
        revisionId: "revision",
        blobObjectId: "blob",
        role: "primary",
      },
    ],
    relations: [],
    tombstones: [],
    auditEvents: [audit],
    schemaPackages: [
      { id: "schema", version: "1.0.0", manifest, status: "active" },
    ],
    ...overrides,
  };
}

describe("resource, dataset, and workspace verification", () => {
  it("runs a scoped, non-vacuous resource check and persists its report", async () => {
    const catalog = new StructuralCatalog(snapshot());
    const service = new StructuralVerificationService(
      new Storage(),
      catalog,
      () => "2026-01-02T00:00:00.000Z",
      () => "resource-run",
    );
    const run = await service.run({
      workspaceId: "workspace",
      level: "resource",
      scope: { kind: "resource", id: "resource" },
    });
    expect(run.status).toBe("passed");
    expect(run.objectsChecked).toBeGreaterThan(3);
    expect(catalog.runs).toEqual([run]);
    expect(await catalog.getReport("workspace", "resource-run")).toEqual(run);
  });

  it("persists missing-scope and schema/blob/relation/tombstone integrity failures", async () => {
    const badRevision = { ...revision, canonicalPayload: {} };
    const catalog = new StructuralCatalog(
      snapshot({
        revisions: [badRevision],
        relations: [
          {
            id: "relation",
            workspaceId: "workspace",
            datasetId: "dataset",
            sourceKind: "resource",
            sourceId: "resource",
            targetKind: "resource",
            targetId: "missing",
            relationType: "references",
            metadata: {},
            createdBy: "actor",
            createdAt: "2026-01-01T00:00:00.000Z",
            endedAt: null,
          },
        ],
        tombstones: [
          {
            id: "tombstone",
            workspaceId: "workspace",
            datasetId: "dataset",
            subjectKind: "resource",
            subjectId: "resource",
            deletedBy: "actor",
            deletedAt: "2026-01-02T00:00:00.000Z",
            recoverUntil: "2026-01-01T00:00:00.000Z",
            priorRevisionId: "revision",
            purgeState: "not_eligible",
          },
        ],
      }),
    );
    const storage = new Storage();
    storage.missing = true;
    const service = new StructuralVerificationService(
      storage,
      catalog,
      () => "2026-01-03T00:00:00.000Z",
      () => "dataset-run",
    );
    const run = await service.run({
      workspaceId: "workspace",
      level: "dataset",
      scope: { kind: "dataset", id: "dataset" },
    });
    expect(run.status).toBe("failed");
    expect(run.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "SCHEMA_MISSING_REQUIRED_FIELD",
        "BLOB_MISSING_OR_INACCESSIBLE",
        "RELATION_ENDPOINT_MISSING",
        "RETENTION_WINDOW_INVALID",
        "TOMBSTONE_STATUS_MISMATCH",
      ]),
    );

    const missing = await service.run({
      workspaceId: "workspace",
      level: "resource",
      scope: { kind: "resource", id: "unknown" },
    });
    expect(missing.issues.map(({ code }) => code)).toEqual(["SCOPE_NOT_FOUND"]);
    expect(catalog.runs).toHaveLength(2);
  });

  it("checks the workspace audit chain and reports orphan blobs", async () => {
    const base = snapshot();
    const catalog = new StructuralCatalog({
      ...base,
      revisionBlobs: [],
      auditEvents: [{ ...base.auditEvents[0]!, eventHash: "0".repeat(64) }],
    });
    const run = await new StructuralVerificationService(
      new Storage(),
      catalog,
    ).run({ workspaceId: "workspace", level: "workspace" });
    expect(run.status).toBe("failed");
    expect(run.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["AUDIT_CHAIN_INVALID", "ORPHAN_BLOB"]),
    );
  });

  it("rejects mismatched structural scopes before reading data", async () => {
    const catalog = new StructuralCatalog(snapshot());
    await expect(
      new StructuralVerificationService(new Storage(), catalog).run({
        workspaceId: "workspace",
        level: "resource",
        scope: { kind: "dataset", id: "dataset" },
      }),
    ).rejects.toThrow("resource verification requires a resource scope");
    expect(catalog.runs).toEqual([]);
  });
});
