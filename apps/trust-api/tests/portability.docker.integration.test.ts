import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  archiveImportCheckpoints,
  canonicalJson,
  readTrustArchive,
  writeTrustArchive,
  type ArchiveImportCheckpoint,
  type TrustArchiveManifest,
} from "@trust-core/archive";
import {
  createIvansDiaryFixture,
  ivansDiarySchema,
} from "@trust-core/fixtures-ivans-diary";
import {
  createWeSketchFixture,
  weSketchSchema,
} from "@trust-core/fixtures-wesketch";
import {
  PostgresTrustRepository,
  deterministicUuid,
  loadArchiveImportInventory,
  runMigrations,
  type DatabasePool,
  type QueryResult,
  type TransactionClient,
} from "@trust-core/persistence-postgres";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertScopedBucket,
  createRunScope,
  quotePostgresIdentifier,
} from "../../../scripts/portability-harness-helpers.mjs";

const enabled = process.env.TRUST_DOCKER_TESTS === "1";
const scope = createRunScope(process.env.TRUST_PORTABILITY_RUN_ID);
const bootstrapUrl =
  process.env.POSTGRES_ADMIN_URL ??
  "postgresql://trust_admin:trust_admin_local_only@localhost:54329/trust_core";
const endpoint = process.env.TRUST_STORAGE_ENDPOINT ?? "http://localhost:5900";
const accessKeyId = process.env.TRUST_STORAGE_ACCESS_KEY ?? "trustcore";
const secretAccessKey =
  process.env.TRUST_STORAGE_SECRET_KEY ?? "trustcore-local-secret";
const region = process.env.TRUST_STORAGE_REGION ?? "us-east-1";
const appRoot = fileURLToPath(new URL("../", import.meta.url));
const root = fileURLToPath(new URL("../../../", import.meta.url));
const migrationsDirectory = resolve(root, "migrations");
const provisioning = resolve(migrationsDirectory, "provisioning.sql");
const tsxCli = resolve(appRoot, "node_modules/tsx/dist/cli.mjs");
const viewerCli = resolve(root, "packages/archive-viewer/src/cli.ts");
const port = 4338;
const baseUrl = `http://127.0.0.1:${port}`;
const token = `portability-token-${scope.runId}`;
const actor = `portability-admin-${scope.runId}`;
const temp = resolve(tmpdir(), `trust-portability-${scope.runId}`);
const bootstrap = new Pool({ connectionString: bootstrapUrl });
const s3 = new S3Client({
  endpoint,
  region,
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});
const ivan = createIvansDiaryFixture();
const sketch = createWeSketchFixture();
const sourceWorkspaces = [ivan, sketch].map((fixture) =>
  deterministicUuid(fixture.workspace.id),
);
const sourceDatasets = [ivan, sketch].map((fixture) =>
  deterministicUuid(fixture.dataset.id),
);
const targetWorkspaces = [ivan, sketch].flatMap((_fixture, fixtureIndex) =>
  archiveImportCheckpoints.map((checkpoint) =>
    deterministicUuid(
      `portability-target-${scope.runId}-${fixtureIndex}-${checkpoint}`,
    ),
  ),
);
const failureTarget = deterministicUuid(
  `portability-target-${scope.runId}-failure`,
);
const allTargetWorkspaces = [...targetWorkspaces, failureTarget];
const finalIvanTarget = targetWorkspaces[0]!;
const finalSketchTarget = targetWorkspaces[archiveImportCheckpoints.length]!;
let sourceOwner: Pool;
let targetOwner: Pool;
let sourceServer: ChildProcess | undefined;
let targetServer: ChildProcess | undefined;
const archives = new Map<string, Buffer>();

describe.runIf(enabled)("Checkpoint 0.2H destructive portability gate", () => {
  beforeAll(async () => {
    await rm(temp, { recursive: true, force: true });
    await mkdir(temp, { recursive: true });
    await createBucket(scope.sourceBucket);
    await createDatabase(scope.sourceDatabase);
    sourceOwner = ownerPool(scope.sourceDatabase);
    await provision(sourceOwner);
    const repository = new PostgresTrustRepository(adaptPool(sourceOwner));
    await repository.seedSyntheticIvan(ivansDiarySchema, ivan);
    await repository.seedSyntheticFixture(weSketchSchema, sketch);
    for (const content of sketch.blobContents) {
      const blob = sketch.blobs.find(({ id }) => id === content.blobObjectId)!;
      await s3.send(
        new PutObjectCommand({
          Bucket: scope.sourceBucket,
          Key: blob.storageKey,
          Body: content.bytes,
          ContentType: blob.mediaType,
          Metadata: { sha256: blob.sha256 },
        }),
      );
    }
  }, 90_000);

  afterAll(async () => {
    await stopServer(sourceServer);
    await stopServer(targetServer);
    await sourceOwner?.end().catch(() => undefined);
    await targetOwner?.end().catch(() => undefined);
    await dropDatabase(scope.sourceDatabase).catch(() => undefined);
    await dropDatabase(scope.targetDatabase).catch(() => undefined);
    await deleteBucket(scope.sourceBucket).catch(() => undefined);
    await deleteBucket(scope.targetBucket).catch(() => undefined);
    await rm(temp, { recursive: true, force: true });
    s3.destroy();
    await bootstrap.end();
  }, 90_000);

  it("exports, destroys source, reconstructs clean target, and rejects hostile archives", async () => {
    sourceServer = await startServer(scope.sourceDatabase, scope.sourceBucket);
    for (let index = 0; index < sourceWorkspaces.length; index += 1) {
      const workspaceId = sourceWorkspaces[index]!;
      const datasetId = sourceDatasets[index]!;
      const verified = await post("/v1/verification/runs", workspaceId, {
        workspaceId,
        level: "dataset",
        scope: { kind: "dataset", id: datasetId },
      });
      expect(verified.status).toBe(200);
      const lineageSeed = Buffer.from(`audit-lineage-${index}-${scope.runId}`);
      const ingested = await post("/v1/objects/ingest", workspaceId, {
        workspaceId,
        idempotencyKey: `lineage-${index}-${scope.runId}`,
        mediaType: "text/plain",
        bytesBase64: lineageSeed.toString("base64"),
      });
      expect(ingested.status).toBe(200);
      const secondIngest = await post("/v1/objects/ingest", workspaceId, {
        workspaceId,
        idempotencyKey: `lineage-second-${index}-${scope.runId}`,
        mediaType: "application/octet-stream",
        bytesBase64: Buffer.from(
          `audit-lineage-second-${index}-${scope.runId}`,
        ).toString("base64"),
      });
      expect(secondIngest.status).toBe(200);
      const exported = await post("/v1/portability/exports", workspaceId, {
        workspaceId,
        datasetIds: [datasetId],
        idempotencyKey: `export-${index}-${scope.runId}`,
      });
      expect(exported.status, JSON.stringify(exported.body)).toBe(200);
      const exportId = stringField(exported.body, "id");
      const download = await get(
        `/v1/portability/exports/${exportId}/download`,
        workspaceId,
      );
      expect(download.status).toBe(200);
      const bytes = Buffer.from(
        stringField(download.body, "archiveBase64"),
        "base64",
      );
      expect(sha256(bytes)).toBe(stringField(exported.body, "sha256"));
      const parsed = await readTrustArchive(bytes);
      expect(parsed.verification).toMatchObject({ valid: true, issues: [] });
      expect(parsed.manifest).toMatchObject({
        workspaceId,
        datasetIds: [datasetId],
        signatureProfile: "unsigned",
        checksumAlgorithm: "sha256",
        canonicalJsonProfile: "trust-core-canonical-json-v1",
      });
      expect(parsed.manifest.blobCount).toBe(
        index === 0 ? 0 : sketch.blobs.length,
      );
      expect(parsed.manifest.auditLineage.sourceWorkspaceId).toBe(workspaceId);
      archives.set(workspaceId, bytes);
      await writeFile(resolve(temp, `${index}.trustarchive`), bytes);
    }
    const sourceAudit = await sourceOwner.query<{
      workspace_id: string;
      action: string;
      request_id: string;
      correlation_id: string;
      metadata_json: unknown;
    }>(
      "SELECT workspace_id,action,request_id,correlation_id,metadata_json FROM audit_events WHERE workspace_id=ANY($1::uuid[]) AND action='archive.exported'",
      [sourceWorkspaces],
    );
    expect(sourceAudit.rowCount).toBe(2);
    expect(
      new Set(sourceAudit.rows.map(({ workspace_id }) => workspace_id)),
    ).toEqual(new Set(sourceWorkspaces));
    expect(
      sourceAudit.rows.every(
        ({ request_id, correlation_id }) =>
          request_id.length > 0 && correlation_id.length > 0,
      ),
    ).toBe(true);

    await stopServer(sourceServer);
    sourceServer = undefined;
    await sourceOwner.end();
    await dropDatabase(scope.sourceDatabase);
    await deleteBucket(scope.sourceBucket);
    const destroyedSource = ownerPool(scope.sourceDatabase);
    await expect(destroyedSource.query("SELECT 1")).rejects.toThrow();
    await destroyedSource.end().catch(() => undefined);
    await expect(
      s3.send(new ListObjectsV2Command({ Bucket: scope.sourceBucket })),
    ).rejects.toThrow();
    archives.clear();
    archives.set(
      sourceWorkspaces[0]!,
      await readFile(resolve(temp, "0.trustarchive")),
    );
    archives.set(
      sourceWorkspaces[1]!,
      await readFile(resolve(temp, "1.trustarchive")),
    );

    for (let index = 0; index < sourceWorkspaces.length; index += 1) {
      const viewerOutput = resolve(temp, `offline-${index}.html`);
      const viewed = await processResult(process.execPath, [
        tsxCli,
        viewerCli,
        resolve(temp, `${index}.trustarchive`),
        "--output",
        viewerOutput,
      ]);
      expect(viewed.code).toBe(0);
      expect(viewed.stdout).toContain("Verified archive");
      expect(await readFile(viewerOutput, "utf8")).toContain("Trust Archive");
    }
    const invalidViewer = await processResult(process.execPath, [
      tsxCli,
      viewerCli,
    ]);
    expect(invalidViewer.code).toBe(2);
    expect(`${invalidViewer.stdout}\n${invalidViewer.stderr}`).toMatch(
      /usage|archive/i,
    );

    await createBucket(scope.targetBucket);
    await createDatabase(scope.targetDatabase);
    targetOwner = ownerPool(scope.targetDatabase);
    await provision(targetOwner);
    for (const [index, workspaceId] of allTargetWorkspaces.entries())
      await targetOwner.query(
        "INSERT INTO workspaces (id,name,slug) VALUES ($1,$2,$3)",
        [
          workspaceId,
          `Portability target ${index}`,
          `port-${scope.runId}-${index}`,
        ],
      );
    targetServer = await startServer(scope.targetDatabase, scope.targetBucket);

    const sketchBytes = archives.get(sourceWorkspaces[1]!)!;
    for (const [name, bytes] of await hostileArchives(sketchBytes)) {
      const before = await reconstructedEffects(finalSketchTarget);
      const rejected = await post(
        "/v1/portability/archives",
        finalSketchTarget,
        {
          workspaceId: finalSketchTarget,
          idempotencyKey: `reject-${name}-${scope.runId}`,
          archiveBase64: bytes.toString("base64"),
        },
      );
      expect(
        rejected.status >= 400 || rejected.body.status === "rejected",
        `${name}: ${rejected.status} ${JSON.stringify(rejected.body)}`,
      ).toBe(true);
      expect(rejected.body.status, name).not.toBe("verified");
      expect(await reconstructedEffects(finalSketchTarget), name).toEqual(
        before,
      );
    }
    const beforeOversized = await reconstructedEffects(finalSketchTarget);
    const oversized = await post(
      "/v1/portability/archives",
      finalSketchTarget,
      {
        workspaceId: finalSketchTarget,
        idempotencyKey: `reject-oversized-${scope.runId}`,
        archiveBase64: "A".repeat(12_000_004),
      },
    );
    expect(oversized.status).toBe(413);
    expect(await reconstructedEffects(finalSketchTarget)).toEqual(
      beforeOversized,
    );
    expect(
      (await fetchUnauthorizedArchive(finalSketchTarget, sketchBytes)).status,
    ).toBe(401);
    expect(
      (await get("/v1/resources", deterministicUuid("unassigned-workspace")))
        .status,
    ).toBe(403);

    for (let fixtureIndex = 0; fixtureIndex < 2; fixtureIndex += 1) {
      for (
        let checkpointIndex = 0;
        checkpointIndex < archiveImportCheckpoints.length;
        checkpointIndex += 1
      ) {
        const checkpoint = archiveImportCheckpoints[checkpointIndex]!;
        const runIndex =
          fixtureIndex * archiveImportCheckpoints.length + checkpointIndex;
        const workspaceId = targetWorkspaces[runIndex]!;
        const sourceBytes = archives.get(sourceWorkspaces[fixtureIndex]!)!;
        const importBytes = await validArchiveVariant(sourceBytes, runIndex);
        const preparedImport = await uploadAndPlan(
          workspaceId,
          importBytes,
          runIndex,
        );
        process.stdout.write(
          `[0.2H] fixture ${fixtureIndex} interrupting after ${checkpoint}\n`,
        );
        await stopServer(targetServer);
        targetServer = await startServer(
          scope.targetDatabase,
          scope.targetBucket,
          checkpoint,
        );
        const request = post(
          `/v1/portability/plans/${preparedImport.planId}/execute`,
          preparedImport.workspaceId,
          preparedImport.command,
        ).catch((error: unknown) => ({ error }));
        const exitCode = await waitForExitWithin(targetServer, 20_000);
        const interruptionResult = await request;
        expect(
          exitCode,
          `${checkpoint}: ${JSON.stringify(interruptionResult)}`,
        ).toBe(86);
        targetServer = await startServer(
          scope.targetDatabase,
          scope.targetBucket,
        );
        const resumed = await post(
          `/v1/portability/plans/${preparedImport.planId}/execute`,
          preparedImport.workspaceId,
          preparedImport.command,
        );
        expect(resumed.status, checkpoint).toBe(200);
        expect(resumed.body).toMatchObject({
          checkpoint: "completed",
          status: "completed",
          resumed: true,
        });
        await assertReconstructedIntegrity(workspaceId, importBytes);
        const beforeReplay = await completeEffectSnapshot(workspaceId);
        const duplicates = await Promise.all(
          [0, 1].map(() =>
            post(
              `/v1/portability/plans/${preparedImport.planId}/execute`,
              preparedImport.workspaceId,
              preparedImport.command,
            ),
          ),
        );
        for (const duplicate of duplicates)
          expect(duplicate.body).toMatchObject({
            id: stringField(resumed.body, "id"),
            checkpoint: "completed",
            resumed: true,
          });
        expect(await completeEffectSnapshot(workspaceId)).toEqual(beforeReplay);
        const operationCount = await targetOwner.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM portability_import_operations WHERE workspace_id=$1 AND plan_id=$2",
          [preparedImport.workspaceId, preparedImport.planId],
        );
        expect(operationCount.rows[0]!.count).toBe(1);
      }
    }

    const failedImport = await uploadAndPlan(
      failureTarget,
      await validArchiveVariant(archives.get(sourceWorkspaces[0]!)!, 99),
      99,
    );
    const failedPlan = (
      await targetOwner.query<{
        plan_json: {
          actions: Array<{
            kind: string;
            targetId: string;
            disposition: string;
            record?: Record<string, unknown>;
          }>;
        };
      }>(
        "SELECT plan_json FROM portability_plans WHERE workspace_id=$1 AND id=$2",
        [failureTarget, failedImport.planId],
      )
    ).rows[0]!.plan_json;
    const staleDataset = failedPlan.actions.find(
      ({ kind, disposition }) =>
        kind === "datasets" && disposition === "insert",
    );
    const staleSchema = failedPlan.actions.find(
      ({ kind, disposition }) =>
        kind === "schema-packages" && disposition === "insert",
    );
    if (!staleDataset?.record)
      throw new Error("Failure proof dataset action was not found.");
    if (staleSchema?.record)
      await targetOwner.query(
        "INSERT INTO schema_packages (id,namespace,name,semantic_version,schema_digest,manifest_json) VALUES ($1,$2,$3,$4,$5,$6::jsonb)",
        [
          staleSchema.targetId,
          String(staleSchema.record.namespace),
          String(staleSchema.record.name),
          String(staleSchema.record.semanticVersion),
          String(staleSchema.record.schemaDigest),
          JSON.stringify(staleSchema.record.manifest),
        ],
      );
    await targetOwner.query(
      "INSERT INTO datasets (id,workspace_id,schema_package_id,dataset_type,name,created_by) VALUES ($1,$2,$3,$4,'stale target','gate')",
      [
        staleDataset.targetId,
        failureTarget,
        String(staleDataset.record.schemaPackageId),
        String(staleDataset.record.datasetType),
      ],
    );
    const beforeFailedImport = await reconstructedEffects(failureTarget);
    const rejectedImport = await post(
      `/v1/portability/plans/${failedImport.planId}/execute`,
      failureTarget,
      failedImport.command,
    );
    expect(rejectedImport.status).toBeGreaterThanOrEqual(400);
    expect(await reconstructedEffects(failureTarget)).toEqual(
      beforeFailedImport,
    );

    await assertFixtureVisible(finalIvanTarget, ivan);
    await assertFixtureVisible(finalSketchTarget, sketch);
    for (const [index, workspaceId] of [
      finalIvanTarget,
      finalSketchTarget,
    ].entries()) {
      const level = index === 0 ? "workspace" : "full_blob";
      const verified = await post("/v1/verification/runs", workspaceId, {
        workspaceId,
        level,
        ...(level === "workspace"
          ? { scope: { kind: "workspace", id: workspaceId } }
          : {}),
      });
      expect(verified.status).toBe(200);
      expect(verified.body).toMatchObject({
        workspaceId,
        level,
        status: "passed",
      });
    }
    expect(
      (
        await targetOwner.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM blob_objects WHERE workspace_id=$1 AND verification_state='verified'",
          [finalSketchTarget],
        )
      ).rows[0]!.count,
    ).toBe(sketch.blobs.length);
    const unknownField = await targetOwner.query<{
      canonical_payload_json: Record<string, unknown>;
    }>(
      "SELECT canonical_payload_json FROM revisions WHERE workspace_id=$1 AND canonical_payload_json ? 'transcriptionConfidence'",
      [finalIvanTarget],
    );
    expect(
      unknownField.rows[0]!.canonical_payload_json.transcriptionConfidence,
    ).toBe(0.91);
    await provisionApplicationPrincipal(finalIvanTarget, "ivan");
    await provisionApplicationPrincipal(finalSketchTarget, "wesketch");
    await stopServer(targetServer);
    const ivanApplicationToken = `ivan-application-${scope.runId}`;
    targetServer = await startServer(
      scope.targetDatabase,
      scope.targetBucket,
      undefined,
      {
        actorId: `restored.ivan.${scope.runId}`,
        token: ivanApplicationToken,
        principalType: "application",
      },
    );
    expect(
      arrayField(
        (await get("/v1/resources", finalIvanTarget, ivanApplicationToken))
          .body,
        "items",
      ),
    ).toHaveLength(ivan.resources.length);
    expect(
      (await get("/v1/resources", finalSketchTarget, ivanApplicationToken))
        .status,
    ).toBe(403);
    await stopServer(targetServer);
    const sketchApplicationToken = `sketch-application-${scope.runId}`;
    targetServer = await startServer(
      scope.targetDatabase,
      scope.targetBucket,
      undefined,
      {
        actorId: `restored.wesketch.${scope.runId}`,
        token: sketchApplicationToken,
        principalType: "application",
      },
    );
    expect(
      arrayField(
        (await get("/v1/resources", finalSketchTarget, sketchApplicationToken))
          .body,
        "items",
      ),
    ).toHaveLength(sketch.resources.length);
    expect(
      (await get("/v1/resources", finalIvanTarget, sketchApplicationToken))
        .status,
    ).toBe(403);
    await stopServer(targetServer);
    targetServer = await startServer(scope.targetDatabase, scope.targetBucket);
    const audit = await targetOwner.query<{
      action: string;
      metadata_json: unknown;
    }>(
      "SELECT action,metadata_json FROM audit_events WHERE workspace_id=ANY($1::uuid[]) ORDER BY occurred_at,id",
      [targetWorkspaces],
    );
    const actions = audit.rows.map(({ action }) => action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "archive.upload.verified",
        "archive.upload.failed",
        "archive.import.planned",
        "archive.import.resumed",
        "archive.imported",
        "archive.import.executed",
      ]),
    );
    for (const workspaceId of targetWorkspaces) {
      const operation = (
        await targetOwner.query<{ id: string }>(
          "SELECT id FROM portability_import_operations WHERE workspace_id=$1",
          [workspaceId],
        )
      ).rows[0]!;
      const lifecycle = await targetOwner.query<{
        action: string;
        request_id: string;
        correlation_id: string;
      }>(
        "SELECT action,request_id,correlation_id FROM audit_events WHERE workspace_id=$1 AND action=ANY($2::text[]) ORDER BY action",
        [
          workspaceId,
          [
            "archive.upload.verified",
            "archive.import.planned",
            "archive.import.resumed",
            "archive.imported",
            "archive.import.executed",
          ],
        ],
      );
      expect(new Set(lifecycle.rows.map(({ action }) => action))).toEqual(
        new Set([
          "archive.upload.verified",
          "archive.import.planned",
          "archive.import.resumed",
          "archive.imported",
          "archive.import.executed",
        ]),
      );
      expect(
        lifecycle.rows.every(
          ({ request_id, correlation_id }) =>
            request_id.length > 0 && correlation_id.length > 0,
        ),
      ).toBe(true);
      expect(
        lifecycle.rows
          .filter(({ action }) =>
            [
              "archive.import.resumed",
              "archive.imported",
              "archive.import.executed",
            ].includes(action),
          )
          .every(({ correlation_id }) => correlation_id === operation.id),
      ).toBe(true);
    }
    expect(
      (
        await targetOwner.query(
          "SELECT id FROM audit_events WHERE workspace_id=$1 AND action='archive.import.failed'",
          [failureTarget],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await targetOwner.query(
          "SELECT id FROM audit_events WHERE workspace_id=$1 AND action IN ('archive.upload.rejected','archive.upload.failed') AND request_id LIKE $2",
          [finalSketchTarget, `reject-%-${scope.runId}`],
        )
      ).rowCount,
    ).toBe(10);
    const auditText = JSON.stringify(audit.rows);
    expect(auditText).not.toContain(token);
    expect(auditText).not.toContain("archiveBase64");
    expect(auditText).not.toContain("Today I drew");
    expect(
      (
        await targetOwner.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM imported_archive_audit_events WHERE workspace_id=ANY($1::uuid[])",
          [targetWorkspaces],
        )
      ).rows[0]!.count,
    ).toBeGreaterThan(0);
    const evidencePath = process.env.TRUST_PORTABILITY_EVIDENCE_PATH;
    if (evidencePath)
      await writeFile(
        evidencePath,
        `${JSON.stringify(
          {
            profile: {
              archiveSignature: "local-unsigned",
              authentication: "same-principal-bootstrap",
              deferred: ["managed-signatures", "OIDC"],
            },
            fixtures: ["Ivan's Diary", "WeSketch"].map((name) => ({
              name,
              checkpointRestarts: [...archiveImportCheckpoints],
              proofs: {
                export: true,
                auditLifecycle: true,
                canonicalRecordsAndHashes: true,
                committedObjectRehash: true,
                targetVerification: true,
                applicationAccessAndIsolation: true,
                offlineViewerAfterSourceDestruction: true,
                duplicateAndConcurrentReplayIdempotency: true,
                sourceDatabaseAndBucketDestroyed: true,
              },
            })),
            negativeCases: [
              "checksum",
              "content-checksum",
              "missing-blob",
              "unsupported-signature",
              "invalid-signature-artifact",
              "path-traversal",
              "compression-ratio",
              "invalid-reference",
              "invalid-parentage",
              "invalid-audit-lineage",
              "oversized-request",
              "stale-target-import-failure",
              "offline-viewer-invalid-invocation-exit-2",
            ],
            sanitized: true,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
  }, 900_000);
});

async function uploadAndPlan(
  workspaceId: string,
  bytes: Buffer,
  index: number,
) {
  const upload = await post("/v1/portability/archives", workspaceId, {
    workspaceId,
    idempotencyKey: `upload-${index}-${scope.runId}`,
    archiveBase64: bytes.toString("base64"),
  });
  expect(upload.status).toBe(200);
  const archiveId = stringField(upload.body, "id");
  const plan = await post("/v1/portability/plans", workspaceId, {
    workspaceId,
    archiveId,
    idempotencyKey: `plan-${index}-${scope.runId}`,
    mode: "mapped_workspace",
    conflictMode: "reject_on_error",
  });
  expect(plan.status, JSON.stringify(plan.body)).toBe(200);
  return {
    workspaceId,
    planId: stringField(plan.body, "id"),
    command: {
      workspaceId,
      idempotencyKey: `execute-${index}-${scope.runId}`,
      confirmation: "IMPORT",
    },
  };
}

async function assertFixtureVisible(
  workspaceId: string,
  fixture: {
    resources: readonly unknown[];
    revisions: readonly unknown[];
    relations: readonly unknown[];
    tombstones: readonly unknown[];
  },
) {
  const [resources, relations, deleted] = await Promise.all([
    get("/v1/resources", workspaceId),
    get("/v1/relations", workspaceId),
    get("/v1/deleted-resources", workspaceId),
  ]);
  expect(resources.status).toBe(200);
  expect(arrayField(resources.body, "items")).toHaveLength(
    fixture.resources.length,
  );
  expect(arrayField(relations.body, "items")).toHaveLength(
    fixture.relations.length,
  );
  expect(arrayField(deleted.body, "items")).toHaveLength(
    fixture.tombstones.length,
  );
  const counts = await targetOwner.query<{
    resources: number;
    revisions: number;
    relations: number;
    tombstones: number;
  }>(
    "SELECT (SELECT count(*)::int FROM resources WHERE workspace_id=$1) resources,(SELECT count(*)::int FROM revisions WHERE workspace_id=$1) revisions,(SELECT count(*)::int FROM relations WHERE workspace_id=$1) relations,(SELECT count(*)::int FROM tombstones WHERE workspace_id=$1) tombstones",
    [workspaceId],
  );
  expect(counts.rows[0]).toEqual({
    resources: fixture.resources.length,
    revisions: fixture.revisions.length,
    relations: fixture.relations.length,
    tombstones: fixture.tombstones.length,
  });
}

async function assertReconstructedIntegrity(
  workspaceId: string,
  archiveBytes: Buffer,
) {
  const parsed = await readTrustArchive(archiveBytes);
  expect(parsed.verification.valid).toBe(true);
  const inventory = await loadArchiveImportInventory(
    adaptPool(targetOwner),
    workspaceId,
  );
  for (const kind of [
    "datasets",
    "resources",
    "revisions",
    "revision-blobs",
    "blobs",
    "relations",
    "tombstones",
  ] as const)
    expect(Object.keys(inventory.records?.[kind] ?? {}), kind).toHaveLength(
      parsed.manifest.recordCounts[kind],
    );
  const expectedRevisions = (parsed.verification.records.revisions ?? [])
    .map((record) => ({
      canonicalPayload: canonicalJson(record.canonicalPayload),
      canonicalPayloadHash: record.canonicalPayloadHash,
    }))
    .sort((left, right) =>
      String(left.canonicalPayloadHash).localeCompare(
        String(right.canonicalPayloadHash),
      ),
    );
  const actualRevisions = (
    await targetOwner.query<{
      canonical_payload_json: unknown;
      canonical_payload_hash: string;
    }>(
      "SELECT canonical_payload_json,canonical_payload_hash FROM revisions WHERE workspace_id=$1 ORDER BY canonical_payload_hash",
      [workspaceId],
    )
  ).rows.map((row) => ({
    canonicalPayload: canonicalJson(row.canonical_payload_json),
    canonicalPayloadHash: row.canonical_payload_hash,
  }));
  expect(actualRevisions).toEqual(expectedRevisions);

  const expectedBlobs = new Map(
    (parsed.verification.records.blobs ?? []).map((record) => [
      String(record.sha256),
      Number(record.byteLength),
    ]),
  );
  const committed = await committedObjectSnapshot(workspaceId);
  expect(
    committed.map(({ sha256, byteLength }) => [sha256, byteLength]),
  ).toEqual(
    [...expectedBlobs].sort(([left], [right]) => left.localeCompare(right)),
  );
}

async function reconstructedEffects(workspaceId: string) {
  const tables = [
    "datasets",
    "resources",
    "revisions",
    "revision_blobs",
    "blob_objects",
    "relations",
    "tombstones",
    "imported_archive_audit_events",
  ];
  const database: Record<string, string> = {};
  for (const table of tables)
    database[table] = (
      await targetOwner.query<{ value: string }>(
        `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text AS value FROM ${table} t WHERE workspace_id=$1`,
        [workspaceId],
      )
    ).rows[0]!.value;
  return {
    database,
    committedObjects: await committedObjectSnapshot(workspaceId),
  };
}

async function completeEffectSnapshot(workspaceId: string) {
  const reconstructed = await reconstructedEffects(workspaceId);
  const tables = [
    "portability_archives",
    "portability_plans",
    "portability_import_operations",
    "audit_events",
  ];
  const lifecycle: Record<string, string> = {};
  for (const table of tables)
    lifecycle[table] = (
      await targetOwner.query<{ value: string }>(
        `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text AS value FROM ${table} t WHERE workspace_id=$1`,
        [workspaceId],
      )
    ).rows[0]!.value;
  const sharedSchemaPackages = (
    await targetOwner.query<{ value: string }>(
      "SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text AS value FROM schema_packages t",
    )
  ).rows[0]!.value;
  const workspace = (
    await targetOwner.query<{ value: string }>(
      "SELECT to_jsonb(t)::text AS value FROM workspaces t WHERE id=$1",
      [workspaceId],
    )
  ).rows[0]!.value;
  return {
    ...reconstructed,
    lifecycle,
    sharedSchemaPackages,
    workspace,
    durableObjects: await allWorkspaceObjectSnapshot(workspaceId),
  };
}

async function committedObjectSnapshot(workspaceId: string) {
  const keys = (
    await targetOwner.query<{ storage_key: string }>(
      "SELECT storage_key FROM blob_objects WHERE workspace_id=$1 ORDER BY storage_key",
      [workspaceId],
    )
  ).rows.map(({ storage_key }) => storage_key);
  return hashObjects(keys);
}

async function allWorkspaceObjectSnapshot(workspaceId: string) {
  const listed = await s3.send(
    new ListObjectsV2Command({
      Bucket: scope.targetBucket,
      Prefix: `workspaces/${workspaceId}/objects/`,
    }),
  );
  return hashObjects(
    (listed.Contents ?? []).flatMap(({ Key }) => (Key ? [Key] : [])).sort(),
  );
}

async function hashObjects(keys: readonly string[]) {
  const result: Array<{
    key: string;
    sha256: string;
    byteLength: number;
  }> = [];
  for (const key of keys) {
    const object = await s3.send(
      new GetObjectCommand({ Bucket: scope.targetBucket, Key: key }),
    );
    if (!object.Body) throw new Error("Committed object body is missing.");
    const hash = createHash("sha256");
    let byteLength = 0;
    for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
      const bytes = Buffer.from(chunk);
      hash.update(bytes);
      byteLength += bytes.byteLength;
    }
    const digest = hash.digest("hex");
    expect(key.endsWith(`/${digest}`)).toBe(true);
    result.push({ key, sha256: digest, byteLength });
  }
  return result;
}

async function provisionApplicationPrincipal(
  workspaceId: string,
  name: "ivan" | "wesketch",
) {
  const principalId = `restored.${name}.${scope.runId}`;
  const application = (
    await targetOwner.query<{ id: string }>(
      "INSERT INTO application_registrations (workspace_id,namespace,name,application_version,capabilities_json) VALUES ($1,$2,$3,'0.2H',$4::jsonb) RETURNING id",
      [
        workspaceId,
        principalId,
        `Restored ${name} application`,
        JSON.stringify(["resource:read", "relation:read", "history:read"]),
      ],
    )
  ).rows[0]!;
  await targetOwner.query(
    "INSERT INTO policy_assignments (workspace_id,principal_type,principal_id,role,scope_kind,scope_id,created_by) VALUES ($1,'application',$2,'admin','application',$3,'portability-gate')",
    [workspaceId, principalId, application.id],
  );
}

async function hostileArchives(
  bytes: Buffer,
): Promise<readonly [string, Buffer][]> {
  const parsed = await readTrustArchive(bytes);
  const mutate = async (
    name: string,
    update: (
      entries: Map<string, Uint8Array>,
      manifest: Record<string, unknown>,
    ) => void,
    validChecksums = false,
  ): Promise<[string, Buffer]> => {
    const entries = new Map(parsed.entries);
    const manifest = JSON.parse(
      Buffer.from(entries.get("manifest.json")!).toString("utf8"),
    ) as Record<string, unknown>;
    update(entries, manifest);
    entries.set("manifest.json", Buffer.from(JSON.stringify(manifest)));
    if (validChecksums) updateChecksums(entries);
    return [
      name,
      Buffer.from(
        await writeTrustArchive({
          entries,
          manifest: manifest as unknown as TrustArchiveManifest,
        }),
      ),
    ];
  };
  const contentPath = [...parsed.entries.keys()].find((path) =>
    path.startsWith("records/resources"),
  )!;
  const blobPath = [...parsed.entries.keys()].find((path) =>
    path.startsWith("blobs/"),
  )!;
  const checksum = await mutate("checksum", (entries) => {
    const value = Buffer.from(entries.get("checksums/sha256sums.txt")!);
    value[0] = value[0] === 97 ? 98 : 97;
    entries.set("checksums/sha256sums.txt", value);
  });
  const content = await mutate("content-checksum", (entries) => {
    entries.set(
      contentPath,
      Buffer.concat([entries.get(contentPath)!, Buffer.from(" ")]),
    );
  });
  const missingBlob = await mutate("missing-blob", (entries) =>
    entries.delete(blobPath),
  );
  const unsupportedSignature = await mutate(
    "unsupported-signature",
    (_entries, manifest) => {
      manifest.signatureProfile = "managed-ed25519";
    },
    true,
  );
  const invalidSignatureArtifact = await mutate(
    "invalid-signature-artifact",
    (entries) => entries.set("signatures/unsigned.sig", Buffer.from("invalid")),
  );
  const pathTraversal = Buffer.from(bytes);
  replaceAll(pathTraversal, "manifest.json", "../evil.jsonx");
  const compressionRatio = await mutate(
    "compression-ratio",
    (entries) => entries.set("README.txt", Buffer.from("a".repeat(500_000))),
    true,
  );
  const invalidReference = await mutate(
    "invalid-reference",
    (entries) =>
      updateJsonl(entries, "records/revisions.jsonl", (records) => {
        records[0] = { ...records[0], resourceId: "missing-resource" };
      }),
    true,
  );
  const invalidParentage = await mutate(
    "invalid-parentage",
    (entries) =>
      updateJsonl(entries, "records/revisions.jsonl", (records) => {
        records[0] = { ...records[0], parentRevisionId: "missing-parent" };
      }),
    true,
  );
  const invalidAuditLineage = await mutate(
    "invalid-audit-lineage",
    (entries) =>
      updateJsonl(entries, "records/audit-events.jsonl", (records) => {
        if (records.length < 2)
          throw new Error("Audit lineage fixture requires two events.");
        records[1] = {
          ...records[1],
          previousEventHash: "c".repeat(64),
        };
      }),
    true,
  );
  return [
    checksum,
    content,
    missingBlob,
    unsupportedSignature,
    invalidSignatureArtifact,
    ["path-traversal", pathTraversal],
    compressionRatio,
    invalidReference,
    invalidParentage,
    invalidAuditLineage,
  ];
}

async function validArchiveVariant(bytes: Buffer, index: number) {
  const parsed = await readTrustArchive(bytes);
  const entries = new Map(parsed.entries);
  entries.set(
    "README.txt",
    Buffer.concat([
      entries.get("README.txt")!,
      Buffer.from(`Harness import variant ${index}\n`),
    ]),
  );
  updateChecksums(entries);
  return Buffer.from(
    await writeTrustArchive({ entries, manifest: parsed.manifest }),
  );
}

function updateChecksums(entries: Map<string, Uint8Array>) {
  const sums = [...entries]
    .filter(([path]) => path !== "checksums/sha256sums.txt")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, value]) => `${sha256(value)}  ${path}`)
    .join("\n");
  entries.set("checksums/sha256sums.txt", Buffer.from(`${sums}\n`));
}

function updateJsonl(
  entries: Map<string, Uint8Array>,
  path: string,
  update: (records: Record<string, unknown>[]) => void,
) {
  const bytes = entries.get(path);
  if (!bytes) throw new Error(`Archive record entry is missing: ${path}`);
  const records = Buffer.from(bytes)
    .toString("utf8")
    .trimEnd()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  update(records);
  entries.set(
    path,
    Buffer.from(
      `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    ),
  );
}

function replaceAll(bytes: Buffer, from: string, to: string) {
  if (from.length !== to.length)
    throw new Error("ZIP path replacement differs in length.");
  let offset = 0;
  while ((offset = bytes.indexOf(from, offset, "utf8")) >= 0) {
    bytes.write(to, offset, "utf8");
    offset += from.length;
  }
}

async function createDatabase(name: string) {
  await bootstrap.query(`CREATE DATABASE ${quotePostgresIdentifier(name)}`);
}

async function dropDatabase(name: string) {
  await bootstrap.query(
    `DROP DATABASE IF EXISTS ${quotePostgresIdentifier(name)} WITH (FORCE)`,
  );
}

function ownerPool(database: string) {
  const url = new URL(bootstrapUrl);
  url.pathname = `/${database}`;
  return new Pool({ connectionString: url.toString() });
}

async function provision(pool: Pool) {
  await runMigrations(adaptPool(pool), migrationsDirectory);
  await pool.query(await readFile(provisioning, "utf8"));
}

async function createBucket(bucket: string) {
  await s3.send(
    new CreateBucketCommand({
      Bucket: assertScopedBucket(bucket, scope.runId),
    }),
  );
}

async function deleteBucket(bucket: string) {
  assertScopedBucket(bucket, scope.runId);
  let continuationToken: string | undefined;
  do {
    const listed = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
      }),
    );
    const objects =
      listed.Contents?.flatMap(({ Key }) => (Key ? [{ Key }] : [])) ?? [];
    if (objects.length)
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: objects },
        }),
      );
    continuationToken = listed.IsTruncated
      ? listed.NextContinuationToken
      : undefined;
  } while (continuationToken);
  await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
}

async function startServer(
  database: string,
  bucket: string,
  failAfter?: ArchiveImportCheckpoint,
  principal?: {
    actorId: string;
    token: string;
    principalType: "application";
  },
) {
  const url = new URL(bootstrapUrl);
  url.pathname = `/${database}`;
  url.username = "trust_app_local";
  url.password = "trust_app_local_only";
  const child = spawn(process.execPath, [tsxCli, "src/server.ts"], {
    cwd: appRoot,
    env: {
      ...process.env,
      DATABASE_URL: url.toString(),
      TRUST_ADMIN_TOKEN: principal?.token ?? token,
      TRUST_ADMIN_ACTOR_ID: principal?.actorId ?? actor,
      TRUST_ADMIN_PRINCIPAL_TYPE: principal?.principalType ?? "user",
      TRUST_WORKSPACE_KEY: `portability-${scope.runId}`,
      TRUST_FIXTURE_WORKSPACE_IDS: [
        ...sourceWorkspaces,
        ...allTargetWorkspaces,
      ].join(","),
      TRUST_API_PORT: String(port),
      TRUST_STORAGE_ENDPOINT: endpoint,
      TRUST_STORAGE_REGION: region,
      TRUST_STORAGE_BUCKET: bucket,
      TRUST_STORAGE_ACCESS_KEY: accessKeyId,
      TRUST_STORAGE_SECRET_KEY: secretAccessKey,
      TRUST_STORAGE_FORCE_PATH_STYLE: "true",
      TRUST_ALLOW_LOCAL_UNSIGNED_ARCHIVES: "true",
      ...(failAfter ? { TRUST_FAIL_AFTER_IMPORT_CHECKPOINT: failAfter } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", () => undefined);
  child.stderr?.on("data", () => undefined);
  await waitForHealth(child);
  return child;
}

async function stopServer(child?: ChildProcess) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  if ((await waitForExitWithin(child, 5_000)) === "timeout") {
    child.kill("SIGKILL");
    await waitForExitWithin(child, 5_000);
  }
}

async function waitForHealth(child: ChildProcess) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`API exited during startup with ${child.exitCode}.`);
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) return;
    } catch {
      // API startup is still in progress.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("API did not become healthy.");
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolvePromise(code));
  });
}

async function waitForExitWithin(child: ChildProcess, milliseconds: number) {
  return Promise.race([
    waitForExit(child),
    new Promise<"timeout">((resolvePromise) =>
      setTimeout(() => resolvePromise("timeout"), milliseconds),
    ),
  ]);
}

async function processResult(file: string, args: readonly string[]) {
  return new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
  }>((resolvePromise, reject) => {
    const child = spawn(file, args, { cwd: root, stdio: "pipe" });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("exit", (code) =>
      resolvePromise({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
  });
}

async function post(
  path: string,
  workspaceId: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-trust-workspace-id": workspaceId,
      "x-trust-reauth": token,
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

async function fetchUnauthorizedArchive(workspaceId: string, bytes: Buffer) {
  const request = () =>
    fetch(`${baseUrl}/v1/portability/archives`, {
      method: "POST",
      headers: {
        connection: "close",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId,
        idempotencyKey: "unauthenticated",
        archiveBase64: bytes.toString("base64"),
      }),
    });
  return request().catch(async () => {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    return request();
  });
}

async function get(
  path: string,
  workspaceId: string,
  authorizationToken = token,
) {
  const options = {
    headers: {
      authorization: `Bearer ${authorizationToken}`,
      "x-trust-workspace-id": workspaceId,
      "x-trust-reauth": token,
    },
  };
  const response = await fetch(`${baseUrl}${path}`, options).catch(async () => {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    return fetch(`${baseUrl}${path}`, options);
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

function stringField(value: Record<string, unknown>, key: string) {
  const result = value[key];
  if (typeof result !== "string") throw new Error(`Missing string ${key}.`);
  return result;
}

function arrayField(value: Record<string, unknown>, key: string) {
  const result = value[key];
  if (!Array.isArray(result)) throw new Error(`Missing array ${key}.`);
  return result;
}

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
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
