import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgresContractRepository,
  PostgresIngestOperationStore,
  PostgresOutboxStore,
  PostgresTrustRepository,
  PostgresVerificationCatalog,
  runMigrations,
  type DatabasePool,
  type QueryResult,
  type TransactionClient,
} from "../src/index.js";

const enabled = process.env.POSTGRES_INTEGRATION === "1";
const bootstrapUrl =
  process.env.POSTGRES_ADMIN_URL ??
  "postgresql://trust_admin:trust_admin_local_only@localhost:54329/trust_core";
const ownerUrl =
  process.env.POSTGRES_TEST_ADMIN_URL ??
  "postgresql://trust_admin:trust_admin_local_only@localhost:54329/trust_core_test";
const appUrl =
  process.env.POSTGRES_TEST_APP_URL ??
  "postgresql://trust_app_local:trust_app_local_only@localhost:54329/trust_core_test";
const workerUrl =
  process.env.POSTGRES_TEST_WORKER_URL ??
  "postgresql://trust_worker_local:trust_worker_local_only@localhost:54329/trust_core_test";
const verifierUrl =
  process.env.POSTGRES_TEST_VERIFIER_URL ??
  "postgresql://trust_verifier_local:trust_verifier_local_only@localhost:54329/trust_core_test";
const auditReaderUrl =
  process.env.POSTGRES_TEST_AUDIT_READER_URL ??
  "postgresql://trust_audit_reader_local:trust_audit_reader_local_only@localhost:54329/trust_core_test";
const backupUrl =
  process.env.POSTGRES_TEST_BACKUP_URL ??
  "postgresql://trust_backup_local:trust_backup_local_only@localhost:54329/trust_core_test";
const migrationsDirectory = fileURLToPath(
  new URL("../../../migrations/", import.meta.url),
);
const bootstrap = new Pool({ connectionString: bootstrapUrl });
const owner = new Pool({ connectionString: ownerUrl });
const pool = adaptPool(owner);
let initiallyApplied: readonly string[] = [];

describe.runIf(enabled)("PostgreSQL Docker integration", () => {
  beforeAll(async () => {
    await bootstrap.query(
      "DROP DATABASE IF EXISTS trust_core_test WITH (FORCE)",
    );
    await bootstrap.query("CREATE DATABASE trust_core_test");
    initiallyApplied = await runMigrations(pool, migrationsDirectory);
    await owner.query(
      await readFile(join(migrationsDirectory, "provisioning.sql"), "utf8"),
    );
  }, 60_000);

  afterAll(async () => {
    await owner.end();
    await bootstrap.end();
  });

  it("applies Release 0.1 migrations exactly once", async () => {
    expect(initiallyApplied).toEqual([
      "0001_release_0_1_core.sql",
      "0002_schema_registry_immutability.sql",
      "0003_history_protection.sql",
      "0004_shared_identity_sessions.sql",
      "0005_verification_runs.sql",
      "0006_reconciliation_worker.sql",
      "0007_release_0_1_contracts.sql",
      "0008_application_registration_idempotency.sql",
      "0009_upload_principal_ownership.sql",
      "0010_ingest_principal_audit.sql",
    ]);
    await expect(runMigrations(pool, migrationsDirectory)).resolves.toEqual([]);
  });

  it("rejects an altered migration by checksum", async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), "trust-core-migrations-"),
    );
    try {
      for (const name of await readdir(migrationsDirectory)) {
        if (/^\d+.*\.sql$/.test(name))
          await writeFile(
            join(temporaryDirectory, name),
            await readFile(join(migrationsDirectory, name)),
          );
      }
      const changed = join(
        temporaryDirectory,
        "0006_reconciliation_worker.sql",
      );
      await writeFile(
        changed,
        `${await readFile(changed, "utf8")}\n-- tampered\n`,
      );
      await expect(runMigrations(pool, temporaryDirectory)).rejects.toThrow(
        "Applied migration changed: 0006_reconciliation_worker.sql",
      );
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("enforces relational constraints and immutable history", async () => {
    const fixture = await createFixture();
    await expect(
      owner.query(
        "INSERT INTO datasets (workspace_id,schema_package_id,dataset_type,name,created_by) VALUES ($1,$2,'test','bad','test')",
        [fixture.workspaceA, "00000000-0000-0000-0000-000000000000"],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      owner.query("UPDATE schema_packages SET schema_digest=$2 WHERE id=$1", [
        fixture.schemaPackage,
        "b".repeat(64),
      ]),
    ).rejects.toThrow(
      "published schema package identity and manifest are immutable",
    );
    await expect(
      owner.query("UPDATE revisions SET change_note='rewritten' WHERE id=$1", [
        fixture.revision,
      ]),
    ).rejects.toThrow("revisions rows are immutable");
    await expect(
      owner.query(
        "UPDATE blob_objects SET storage_key='rewritten' WHERE id=$1",
        [fixture.blob],
      ),
    ).rejects.toThrow("blob identity and storage coordinates are immutable");
    await expect(
      owner.query(
        "INSERT INTO application_registrations (workspace_id,namespace,name,application_version,idempotency_key) VALUES ($1,$2,'Invalid key-only registration','1.0.0','key-only')",
        [fixture.workspaceA, `invalid.key-only.${randomUUID()}`],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      owner.query(
        "INSERT INTO application_registrations (workspace_id,namespace,name,application_version,request_fingerprint) VALUES ($1,$2,'Invalid fingerprint-only registration','1.0.0',$3)",
        [
          fixture.workspaceA,
          `invalid.fingerprint-only.${randomUUID()}`,
          "a".repeat(64),
        ],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("denies application access across workspace RLS boundaries", async () => {
    const fixture = await createFixture();
    await owner.query(
      "INSERT INTO application_registrations (workspace_id,namespace,name,application_version) VALUES ($1,'test.a','A','1.0.0'),($2,'test.b','B','1.0.0')",
      [fixture.workspaceA, fixture.workspaceB],
    );
    const app = new Pool({ connectionString: appUrl, max: 1 });
    try {
      await app.query("SELECT set_config('trust.workspace_id',$1,false)", [
        fixture.workspaceA,
      ]);
      const visible = await app.query<{ workspace_id: string }>(
        "SELECT workspace_id FROM datasets ORDER BY workspace_id",
      );
      expect(visible.rows).toEqual([{ workspace_id: fixture.workspaceA }]);
      expect(
        (await app.query("SELECT id FROM application_registrations")).rowCount,
      ).toBe(1);
      await expect(
        app.query(
          "INSERT INTO policy_assignments (workspace_id,principal_type,principal_id,role,scope_kind,scope_id,created_by) VALUES ($1::uuid,'user','attacker','owner','workspace',$1::text,'attacker')",
          [fixture.workspaceA],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        app.query(
          "UPDATE policy_assignments SET role='owner' WHERE workspace_id=$1",
          [fixture.workspaceA],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        app.query(
          "INSERT INTO break_glass_grants (workspace_id,principal_id,reason,actions_json,granted_by,expires_at) VALUES ($1,'attacker','escalate','[\"resource:restore\"]','attacker',now() + interval '1 hour')",
          [fixture.workspaceA],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        app.query(
          "INSERT INTO datasets (workspace_id,schema_package_id,dataset_type,name,created_by) VALUES ($1,$2,'test','cross-workspace','test')",
          [fixture.workspaceB, fixture.schemaPackage],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await app.end();
    }
  });

  it("allows worker outbox access without dataset privileges", async () => {
    const fixture = await createFixture();
    const operation = (
      await owner.query<{ id: string }>(
        "INSERT INTO operations (workspace_id,operation_type,idempotency_key,state,requested_by,request_json) VALUES ($1,'test','worker-proof','pending','test','{}') RETURNING id",
        [fixture.workspaceA],
      )
    ).rows[0]!;
    await owner.query(
      "INSERT INTO outbox_events (workspace_id,operation_id,event_type,payload_json) VALUES ($1,$2,'proof','{}')",
      [fixture.workspaceA, operation.id],
    );
    const worker = new Pool({ connectionString: workerUrl, max: 1 });
    try {
      const outbox = await worker.query(
        "SELECT id FROM outbox_events WHERE operation_id=$1",
        [operation.id],
      );
      expect(outbox.rowCount).toBe(1);
      await expect(
        worker.query("SELECT id FROM datasets"),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await worker.end();
    }
  });

  it("allows the dedicated worker to claim cross-workspace outbox work only", async () => {
    const fixture = await createFixture();
    await owner.query("DELETE FROM outbox_events");
    const operations = await Promise.all(
      [fixture.workspaceA, fixture.workspaceB].map(
        async (workspaceId, index) =>
          (
            await owner.query<{ id: string }>(
              "INSERT INTO operations (workspace_id,operation_type,idempotency_key,state,requested_by,request_json) VALUES ($1,'cross-workspace-worker',$2,'pending','test','{}') RETURNING id",
              [workspaceId, `cross-workspace-${index}-${randomUUID()}`],
            )
          ).rows[0]!.id,
      ),
    );
    await Promise.all(
      operations.map((operationId, index) =>
        owner.query(
          "INSERT INTO outbox_events (workspace_id,operation_id,event_type,payload_json,available_at) VALUES ($1,$2,'proof','{}','2026-08-04T00:00:00.000Z')",
          [index === 0 ? fixture.workspaceA : fixture.workspaceB, operationId],
        ),
      ),
    );
    const source = new Pool({ connectionString: workerUrl, max: 1 });
    const store = new PostgresOutboxStore(adaptPool(source));
    try {
      const claimed = await store.claim({
        workerId: "cross-workspace-worker",
        limit: 10,
        now: "2026-08-04T00:00:01.000Z",
        leaseUntil: "2026-08-04T00:00:31.000Z",
      });
      expect(new Set(claimed.map(({ workspaceId }) => workspaceId))).toEqual(
        new Set([fixture.workspaceA, fixture.workspaceB]),
      );
      await expect(
        source.query("SELECT id FROM datasets"),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await source.end();
    }
  });

  it("persists ingest checkpoints and context across service restarts", async () => {
    const fixture = await createFixture(),
      first = new PostgresIngestOperationStore(pool),
      request = {
        workspaceId: fixture.workspaceA,
        idempotencyKey: "restart-proof",
        actorId: "actor",
        principalType: "user" as const,
        requestHash: "request-hash",
        request: {
          sha256: "a".repeat(64),
          byteLength: 4,
          mediaType: "text/plain",
        },
      };
    const started = await first.begin(request);
    await first.markCheckpoint(fixture.workspaceA, started.id, "authorised");
    await first.saveContext(
      fixture.workspaceA,
      started.id,
      { temporaryKey: "temporary/object" },
      "temporary_upload_created",
    );
    await first.markCheckpoint(
      fixture.workspaceA,
      started.id,
      "temporary_upload_created",
    );
    const restarted = await new PostgresIngestOperationStore(pool).begin(
      request,
    );
    expect(restarted.id).toBe(started.id);
    expect(restarted.checkpoints).toEqual([
      "authorised",
      "temporary_upload_created",
    ]);
    expect(restarted.context).toEqual({ temporaryKey: "temporary/object" });
  });

  it("enforces lease ownership, stale completion, retry, and quarantine incidents", async () => {
    const fixture = await createFixture(),
      operation = (
        await owner.query<{ id: string }>(
          "INSERT INTO operations (workspace_id,operation_type,idempotency_key,state,requested_by,request_json) VALUES ($1,'lease-proof',$2,'pending','test','{}') RETURNING id",
          [fixture.workspaceA, randomUUID()],
        )
      ).rows[0]!,
      event = (
        await owner.query<{ id: string }>(
          "INSERT INTO outbox_events (workspace_id,operation_id,event_type,payload_json,available_at) VALUES ($1,$2,'proof','{}',$3) RETURNING id",
          [fixture.workspaceA, operation.id, "2026-08-04T00:00:00.000Z"],
        )
      ).rows[0]!,
      store = new PostgresOutboxStore(pool);
    expect(
      await store.claim({
        workspaceId: fixture.workspaceA,
        workerId: "worker-a",
        limit: 1,
        now: "2026-08-04T00:00:01.000Z",
        leaseUntil: "2026-08-04T00:00:31.000Z",
      }),
    ).toHaveLength(1);
    expect(
      await store.claim({
        workspaceId: fixture.workspaceA,
        workerId: "worker-b",
        limit: 1,
        now: "2026-08-04T00:00:02.000Z",
        leaseUntil: "2026-08-04T00:00:32.000Z",
      }),
    ).toEqual([]);
    await expect(
      store.complete(
        fixture.workspaceA,
        event.id,
        "worker-a",
        "2026-08-04T00:00:32.000Z",
      ),
    ).rejects.toThrow("lease was lost");
    expect(
      await store.claim({
        workspaceId: fixture.workspaceA,
        workerId: "worker-b",
        limit: 1,
        now: "2026-08-04T00:00:32.000Z",
        leaseUntil: "2026-08-04T00:01:02.000Z",
      }),
    ).toHaveLength(1);
    await store.retry(fixture.workspaceA, event.id, "worker-b", {
      attemptCount: 1,
      failedAt: "2026-08-04T00:00:33.000Z",
      availableAt: "2026-08-04T00:00:34.000Z",
      error: "transient",
    });
    expect(
      await store.claim({
        workspaceId: fixture.workspaceA,
        workerId: "worker-c",
        limit: 1,
        now: "2026-08-04T00:00:34.000Z",
        leaseUntil: "2026-08-04T00:01:04.000Z",
      }),
    ).toHaveLength(1);
    await store.quarantine(fixture.workspaceA, event.id, "worker-c", {
      attemptCount: 2,
      quarantinedAt: "2026-08-04T00:00:35.000Z",
      reason: "terminal",
    });
    const incident = await owner.query<{ code: string }>(
      "SELECT code FROM reconciliation_incidents WHERE operation_id=$1",
      [operation.id],
    );
    expect(incident.rows).toEqual([{ code: "OUTBOX_EVENT_QUARANTINED" }]);
  });

  it("provisions verification, audit, and backup roles without tenant-table ownership", async () => {
    const fixture = await createFixture();
    const verifier = new Pool({ connectionString: verifierUrl, max: 1 });
    const auditReader = new Pool({ connectionString: auditReaderUrl, max: 1 });
    const backup = new Pool({ connectionString: backupUrl, max: 1 });
    try {
      const owners = await owner.query<{ tableowner: string }>(
        "SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname='public' AND tablename IN ('datasets','resources','revisions','blob_objects','audit_events')",
      );
      expect(owners.rows.map(({ tableowner }) => tableowner)).toEqual([
        "trust_admin",
      ]);

      await verifier.query("SELECT set_config('trust.workspace_id',$1,false)", [
        fixture.workspaceA,
      ]);
      expect(
        (
          await verifier.query("SELECT id FROM blob_objects WHERE id=$1", [
            fixture.blob,
          ])
        ).rowCount,
      ).toBe(1);
      expect((await verifier.query("SELECT id FROM datasets")).rowCount).toBe(
        1,
      );
      await expect(
        verifier.query("UPDATE datasets SET name='verification-write'"),
      ).rejects.toMatchObject({ code: "42501" });

      await auditReader.query(
        "SELECT set_config('trust.workspace_id',$1,false)",
        [fixture.workspaceA],
      );
      await expect(
        auditReader.query(
          "INSERT INTO audit_events (workspace_id,actor_type,actor_id,action,subject_kind,subject_id,request_id,correlation_id,event_hash) VALUES ($1,'service','test','test','resource','test','test','test',$2)",
          [fixture.workspaceA, "d".repeat(64)],
        ),
      ).rejects.toMatchObject({ code: "42501" });

      await backup.query("SET ROLE trust_backup_restore");
      expect(
        (
          await backup.query("SELECT id FROM workspaces WHERE id IN ($1,$2)", [
            fixture.workspaceA,
            fixture.workspaceB,
          ])
        ).rowCount,
      ).toBe(2);
      await expect(
        backup.query(
          "UPDATE revisions SET change_note='backup-rewrite' WHERE id=$1",
          [fixture.revision],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await verifier.end();
      await auditReader.end();
      await backup.end();
    }
  });

  it("loads attached blobs and persists retrievable scoped verification reports", async () => {
    const fixture = await createFixture();
    const catalog = new PostgresVerificationCatalog(pool);
    const snapshot = await catalog.loadSnapshot(fixture.workspaceA);
    expect(snapshot.workspaceExists).toBe(true);
    expect(snapshot.resources).toHaveLength(1);
    expect(snapshot.revisions).toHaveLength(1);
    expect(snapshot.blobs).toHaveLength(1);
    expect(snapshot.revisionBlobs).toEqual([
      expect.objectContaining({
        revisionId: fixture.revision,
        blobObjectId: fixture.blob,
        role: "primary",
      }),
    ]);

    const reportId = randomUUID();
    await catalog.recordRun({
      id: reportId,
      workspaceId: fixture.workspaceA,
      level: "dataset",
      scope: { kind: "dataset", id: snapshot.datasets[0]!.id },
      status: "failed",
      startedAt: "2026-08-04T00:00:00.000Z",
      completedAt: "2026-08-04T00:00:01.000Z",
      objectsChecked: 4,
      bytesRead: 0,
      issues: [
        {
          code: "PROOF_ISSUE",
          severity: "error",
          subjectKind: "dataset",
          subjectId: snapshot.datasets[0]!.id,
          message: "Persisted proof",
        },
      ],
    });
    await expect(
      catalog.getReport(fixture.workspaceA, reportId),
    ).resolves.toEqual(
      expect.objectContaining({
        id: reportId,
        scope: { kind: "dataset", id: snapshot.datasets[0]!.id },
        objectsChecked: 4,
        issues: [expect.objectContaining({ code: "PROOF_ISSUE" })],
      }),
    );
    await expect(
      catalog.listReports(fixture.workspaceA, {
        kind: "dataset",
        id: snapshot.datasets[0]!.id,
      }),
    ).resolves.toEqual([expect.objectContaining({ id: reportId })]);
  });

  it("derives live snapshot integrity from applicable verification runs", async () => {
    const fixture = await createFixture();
    const repository = new PostgresTrustRepository(pool);
    const catalog = new PostgresVerificationCatalog(pool);
    const before = await repository.getSnapshot(fixture.workspaceA);
    expect(before.datasets[0]).toMatchObject({
      health: "unknown",
      lastVerified: "Not verified",
    });
    expect(before.status).toMatchObject({
      canonicalIntegrityPercent: null,
      canonicalIntegrityStatus: "unknown",
    });

    const datasetId = (
      await owner.query<{ id: string }>(
        "SELECT id FROM datasets WHERE workspace_id=$1",
        [fixture.workspaceA],
      )
    ).rows[0]!.id;
    await catalog.recordRun({
      id: randomUUID(),
      workspaceId: fixture.workspaceA,
      level: "workspace",
      scope: { kind: "dataset", id: datasetId },
      status: "failed",
      startedAt: "2026-08-04T00:00:00.000Z",
      completedAt: "2026-08-04T00:00:01.000Z",
      objectsChecked: 1,
      bytesRead: 0,
      issues: [],
    });
    await catalog.recordRun({
      id: randomUUID(),
      workspaceId: fixture.workspaceA,
      level: "dataset",
      scope: { kind: "workspace", id: fixture.workspaceA },
      status: "failed",
      startedAt: "2026-08-04T00:00:02.000Z",
      completedAt: "2026-08-04T00:00:03.000Z",
      objectsChecked: 1,
      bytesRead: 0,
      issues: [],
    });
    await expect(repository.getSnapshot(fixture.workspaceA)).resolves.toEqual(
      expect.objectContaining({
        status: expect.objectContaining({
          canonicalIntegrityPercent: null,
          canonicalIntegrityStatus: "unknown",
        }),
        datasets: [
          expect.objectContaining({
            health: "unknown",
            lastVerified: "Not verified",
          }),
        ],
      }),
    );

    await catalog.recordRun({
      id: randomUUID(),
      workspaceId: fixture.workspaceA,
      level: "dataset",
      scope: { kind: "dataset", id: datasetId },
      status: "failed",
      startedAt: "2026-08-04T00:00:04.000Z",
      completedAt: "2026-08-04T00:00:05.000Z",
      objectsChecked: 1,
      bytesRead: 0,
      issues: [],
    });
    const after = await repository.getSnapshot(fixture.workspaceA);
    expect(after.datasets[0]?.health).toBe("degraded");
    expect(after.status).toMatchObject({
      canonicalIntegrityPercent: 0,
      canonicalIntegrityStatus: "degraded",
    });
  });

  it("returns null canonical integrity for an empty workspace snapshot", async () => {
    const workspaceId = (
      await owner.query<{ id: string }>(
        "INSERT INTO workspaces (name,slug) VALUES ('Empty workspace',$1) RETURNING id",
        [`empty-${randomUUID()}`],
      )
    ).rows[0]!.id;

    await expect(
      new PostgresTrustRepository(pool).getSnapshot(workspaceId),
    ).resolves.toEqual(
      expect.objectContaining({
        status: expect.objectContaining({
          protectedDatasets: 0,
          canonicalIntegrityPercent: null,
          canonicalIntegrityStatus: "unknown",
        }),
        datasets: [],
      }),
    );
  });

  it("serves workspace-scoped query contracts and idempotent upload sessions", async () => {
    const fixture = await createFixture();
    const contracts = new PostgresContractRepository(pool);
    await expect(contracts.listWorkspaces(fixture.workspaceA)).resolves.toEqual(
      [expect.objectContaining({ id: fixture.workspaceA, status: "active" })],
    );
    const datasets = await contracts.listDatasets(fixture.workspaceA);
    expect(datasets).toHaveLength(1);
    const resources = await contracts.listResources(fixture.workspaceA);
    expect(resources).toHaveLength(1);
    await expect(
      contracts.getRevisionGraph(fixture.workspaceA, resources[0]!.id),
    ).resolves.toEqual(
      expect.objectContaining({
        resourceId: resources[0]!.id,
        revisions: [expect.objectContaining({ id: fixture.revision })],
      }),
    );
    await expect(contracts.listDatasets(fixture.workspaceB)).resolves.toEqual([
      expect.objectContaining({ workspaceId: fixture.workspaceB }),
    ]);

    const registration = {
      id: randomUUID(),
      workspaceId: fixture.workspaceA,
      namespace: `test.${randomUUID()}`,
      name: "Idempotent app",
      applicationVersion: "1.0.0",
      schemaPackageIds: [fixture.schemaPackage],
      capabilities: ["resource:read"],
      idempotencyKey: `application-${randomUUID()}`,
      status: "active" as const,
      createdAt: "2026-08-04T00:00:00.000Z",
      updatedAt: "2026-08-04T00:00:00.000Z",
    };
    const registered = await contracts.registerApplication(registration);
    await expect(
      contracts.registerApplication({ ...registration, id: randomUUID() }),
    ).resolves.toEqual(registered);
    await expect(
      contracts.registerApplication({
        ...registration,
        id: randomUUID(),
        name: "Conflicting app",
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const input = {
      workspaceId: fixture.workspaceA,
      actorId: "application.a",
      principalType: "application" as const,
      idempotencyKey: `upload-${randomUUID()}`,
      mediaType: "text/plain",
      expectedByteLength: 4,
      expectedSha256: "f".repeat(64),
      expiresInSeconds: 3600,
      expiresAt: "2026-08-04T01:00:00.000Z",
      now: "2026-08-04T00:00:00.000Z",
    };
    const created = await contracts.createUploadSession(input);
    expect(created).toMatchObject({
      state: "requested",
      status: "pending",
      expectedByteLength: 4,
      expectedSha256: "f".repeat(64),
    });
    await expect(contracts.createUploadSession(input)).resolves.toEqual(
      created,
    );
    await expect(
      contracts.createUploadSession({ ...input, expectedByteLength: 5 }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const otherApplication = {
      ...input,
      actorId: "application.b",
    };
    const otherCreated =
      await contracts.createUploadSession(otherApplication);
    expect(otherCreated.id).not.toBe(created.id);
    const actorA = {
      id: input.actorId,
      displayName: "Application A",
      roles: [],
      workspaceIds: [],
      principalType: "application" as const,
    };
    const actorB = {
      ...actorA,
      id: otherApplication.actorId,
      displayName: "Application B",
    };
    await expect(
      contracts.getUploadSession(fixture.workspaceA, created.id, actorB),
    ).resolves.toBeUndefined();
    const completed = await contracts.completeUploadSession({
      workspaceId: fixture.workspaceA,
      uploadId: created.id,
      actor: actorA,
      blobId: fixture.blob,
      ingestOperationId: randomUUID(),
      completedAt: "2026-08-04T00:01:00.000Z",
    });
    await expect(
      contracts.completeUploadSession({
        workspaceId: fixture.workspaceA,
        uploadId: otherCreated.id,
        actor: actorA,
        blobId: fixture.blob,
        ingestOperationId: randomUUID(),
        completedAt: "2026-08-04T00:01:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "OPERATION_NOT_FOUND" });
    expect(completed).toMatchObject({
      state: "completed",
      status: "succeeded",
      blobId: fixture.blob,
      completedAt: "2026-08-04T00:01:00.000Z",
    });
    await expect(
      contracts.getUploadSession(fixture.workspaceB, created.id, actorA),
    ).resolves.toBeUndefined();

    const app = new Pool({ connectionString: appUrl, max: 1 });
    try {
      await app.query("SELECT set_config('trust.workspace_id',$1,false)", [
        fixture.workspaceA,
      ]);
      await app.query(
        "SELECT set_config('trust.principal_type','application',false),set_config('trust.principal_id',$1,false)",
        [actorB.id],
      );
      expect(
        (
          await app.query(
            "SELECT id FROM upload_sessions WHERE id IN ($1,$2) ORDER BY id",
            [created.id, otherCreated.id],
          )
        ).rows,
      ).toEqual([{ id: otherCreated.id }]);
      expect(
        (
          await app.query(
            "UPDATE upload_sessions SET state='rejected' WHERE id=$1",
            [created.id],
          )
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await app.query(
            "SELECT id FROM operations WHERE id IN ($1,$2) ORDER BY id",
            [created.operationId, otherCreated.operationId],
          )
        ).rows,
      ).toEqual([{ id: otherCreated.operationId }]);
      await expect(
        app.query(
          "UPDATE operations SET requested_by='application.a',requested_by_principal_type='application',idempotency_scope='application:application.a' WHERE id=$1",
          [otherCreated.operationId],
        ),
      ).rejects.toThrow("upload operation ownership is immutable");
    } finally {
      await app.end();
    }
  });
});

async function createFixture(): Promise<{
  workspaceA: string;
  workspaceB: string;
  schemaPackage: string;
  revision: string;
  blob: string;
}> {
  const suffix = randomUUID();
  const workspaceA = (
    await owner.query<{ id: string }>(
      "INSERT INTO workspaces (name,slug) VALUES ('A',$1) RETURNING id",
      [`a-${suffix}`],
    )
  ).rows[0]!.id;
  const workspaceB = (
    await owner.query<{ id: string }>(
      "INSERT INTO workspaces (name,slug) VALUES ('B',$1) RETURNING id",
      [`b-${suffix}`],
    )
  ).rows[0]!.id;
  const schemaPackage = (
    await owner.query<{ id: string }>(
      "INSERT INTO schema_packages (namespace,name,semantic_version,schema_digest,manifest_json) VALUES ('test',$1,'1.0.0',$2,'{}') RETURNING id",
      [`schema-${suffix}`, "a".repeat(64)],
    )
  ).rows[0]!.id;
  const datasetA = (
    await owner.query<{ id: string }>(
      "INSERT INTO datasets (workspace_id,schema_package_id,dataset_type,name,created_by) VALUES ($1,$2,'test','A','test') RETURNING id",
      [workspaceA, schemaPackage],
    )
  ).rows[0]!.id;
  await owner.query(
    "INSERT INTO datasets (workspace_id,schema_package_id,dataset_type,name,created_by) VALUES ($1,$2,'test','B','test')",
    [workspaceB, schemaPackage],
  );
  const resource = (
    await owner.query<{ id: string }>(
      "INSERT INTO resources (workspace_id,dataset_id,resource_type,title,created_by) VALUES ($1,$2,'test','proof','test') RETURNING id",
      [workspaceA, datasetA],
    )
  ).rows[0]!.id;
  const revision = (
    await owner.query<{ id: string }>(
      "INSERT INTO revisions (workspace_id,dataset_id,resource_id,revision_number,schema_package_id,schema_version,canonical_payload_json,canonical_payload_hash,created_by,source) VALUES ($1,$2,$3,1,$4,'1.0.0','{}',$5,'test','user') RETURNING id",
      [workspaceA, datasetA, resource, schemaPackage, "c".repeat(64)],
    )
  ).rows[0]!.id;
  const blob = (
    await owner.query<{ id: string }>(
      "INSERT INTO blob_objects (workspace_id,sha256,byte_length,media_type,storage_provider,storage_key) VALUES ($1,$2,4,'text/plain','minio',$3) RETURNING id",
      [
        workspaceA,
        "e".repeat(64),
        `workspaces/${workspaceA}/objects/${"e".repeat(64)}`,
      ],
    )
  ).rows[0]!.id;
  await owner.query(
    "INSERT INTO revision_blobs (workspace_id,revision_id,blob_object_id,role,logical_name) VALUES ($1,$2,$3,'primary','proof.txt')",
    [workspaceA, revision, blob],
  );
  return { workspaceA, workspaceB, schemaPackage, revision, blob };
}

function adaptPool(source: Pool): DatabasePool {
  const query = async <Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>> => {
    const result = await source.query(text, values ? [...values] : undefined);
    return { rows: result.rows as Row[], rowCount: result.rowCount };
  };
  return {
    query,
    async connect() {
      const client = await source.connect();
      return {
        query: async <Row>(text: string, values?: readonly unknown[]) => {
          const result = await client.query(
            text,
            values ? [...values] : undefined,
          );
          return { rows: result.rows as Row[], rowCount: result.rowCount };
        },
        release: () => client.release(),
      } satisfies TransactionClient;
    },
    end: () => source.end(),
  };
}
