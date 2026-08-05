import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
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
  runMigrations,
  type DatabasePool,
  type QueryResult,
  type TransactionClient,
} from "@trust-core/persistence-postgres";
import { ingestCheckpoints } from "@trust-core/operations";
import { createTrustClient } from "@trust-core/sdk";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.TRUST_DOCKER_TESTS === "1";
const bootstrapUrl =
  process.env.POSTGRES_ADMIN_URL ??
  "postgresql://trust_admin:trust_admin_local_only@localhost:54329/trust_core";
const databaseName = "trust_core_api_docker_test";
const ownerUrl = `postgresql://trust_admin:trust_admin_local_only@localhost:54329/${databaseName}`;
const appUrl = `postgresql://trust_app_local:trust_app_local_only@localhost:54329/${databaseName}`;
const endpoint = process.env.TRUST_STORAGE_ENDPOINT ?? "http://localhost:5900";
const bucket = process.env.TRUST_STORAGE_BUCKET ?? "trust-core-local";
const accessKeyId = process.env.TRUST_STORAGE_ACCESS_KEY ?? "trustcore";
const secretAccessKey =
  process.env.TRUST_STORAGE_SECRET_KEY ?? "trustcore-local-secret";
const appRoot = fileURLToPath(new URL("../", import.meta.url));
const migrationsDirectory = fileURLToPath(
  new URL("../../../migrations/", import.meta.url),
);
const tsxCli = fileURLToPath(
  new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url),
);
const runId = randomUUID();
const workspaceKey = `docker-process-${runId}`;
const workspaceId = deterministicUuid(workspaceKey);
const syntheticWorkspaceId = deterministicUuid(
  createIvansDiaryFixture().workspace.id,
);
const weSketchFixture = createWeSketchFixture();
const weSketchWorkspaceId = deterministicUuid(weSketchFixture.workspace.id);
const weSketchDatasetId = deterministicUuid(weSketchFixture.dataset.id);
const adminToken = `docker-token-${runId}`;
const port = 4327;
const baseUrl = `http://127.0.0.1:${port}`;
const bootstrap = new Pool({ connectionString: bootstrapUrl });
const ownerSource = new Pool({ connectionString: ownerUrl });
const owner = adaptPool(ownerSource);
const s3 = new S3Client({
  endpoint,
  region: process.env.TRUST_STORAGE_REGION ?? "us-east-1",
  forcePathStyle: true,
  credentials: { accessKeyId, secretAccessKey },
});

describe.runIf(enabled)("Release 0.1 live API Docker integration", () => {
  beforeAll(async () => {
    await bootstrap.query(
      `DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`,
    );
    await bootstrap.query(`CREATE DATABASE ${databaseName}`);
    await runMigrations(owner, migrationsDirectory);
    await ownerSource.query(
      await readFile(
        new URL("../../../migrations/provisioning.sql", import.meta.url),
        "utf8",
      ),
    );
    await new PostgresTrustRepository(owner).seedSyntheticIvan(
      ivansDiarySchema,
      createIvansDiaryFixture(),
    );
    await new PostgresTrustRepository(owner).seedSyntheticFixture(
      weSketchSchema,
      weSketchFixture,
    );
    for (const content of weSketchFixture.blobContents) {
      const blob = weSketchFixture.blobs.find(
        ({ id }) => id === content.blobObjectId,
      )!;
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: blob.storageKey,
          Body: content.bytes,
          ContentType: blob.mediaType,
          Metadata: { sha256: blob.sha256 },
        }),
      );
    }
    await ownerSource.query(
      "INSERT INTO workspaces (id,name,slug) VALUES ($1,'Docker process proof',$2)",
      [workspaceId, workspaceKey],
    );
  }, 60_000);

  afterAll(async () => {
    await deleteRunObjects();
    s3.destroy();
    await ownerSource.end();
    await bootstrap.query(
      `DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`,
    );
    await bootstrap.end();
  }, 60_000);

  it("proves live health, ingest, full verification, revision, deletion, and restoration", async () => {
    const server = await startServer();
    try {
      const health = await getJson("/health");
      expect(health).toMatchObject({
        service: "trust-api",
        status: "ok",
        mode: "live",
      });

      for (const fixture of [createIvansDiaryFixture(), weSketchFixture]) {
        const fixtureWorkspaceId = deterministicUuid(fixture.workspace.id);
        const client = createTrustClient({
          baseUrl,
          workspaceId: fixtureWorkspaceId,
          accessToken: adminToken,
        });
        const [datasets, resources, relations] = await Promise.all([
          client.datasets.list(),
          client.resources.list(),
          client.relations.list(),
        ]);
        expect(datasets.items).toEqual([
          expect.objectContaining({ workspaceId: fixtureWorkspaceId }),
        ]);
        expect(resources.items).toHaveLength(fixture.resources.length);
        expect(relations.items).toHaveLength(fixture.relations.length);
      }
      const weSketchClient = createTrustClient({
        baseUrl,
        workspaceId: weSketchWorkspaceId,
        accessToken: adminToken,
      });
      const lineageVerification = await weSketchClient.verification.run({
        level: "dataset",
        scope: { kind: "dataset", id: weSketchDatasetId },
      });
      expect(lineageVerification).toMatchObject({
        workspaceId: weSketchWorkspaceId,
        level: "dataset",
        status: "passed",
        scope: { kind: "dataset", id: weSketchDatasetId },
        issues: [],
      });
      expect(lineageVerification.objectsChecked).toBeGreaterThan(
        weSketchFixture.resources.length,
      );
      expect(
        (
          await ownerSource.query(
            "SELECT count(*)::int AS count FROM revision_blobs WHERE workspace_id=$1",
            [weSketchWorkspaceId],
          )
        ).rows[0],
      ).toEqual({ count: weSketchFixture.revisionBlobs.length });

      const bytes = Buffer.from(`live-api-${runId}`);
      const ingest = await postJson("/v1/objects/ingest", {
        workspaceId,
        idempotencyKey: `live-${runId}`,
        mediaType: "text/plain",
        bytesBase64: bytes.toString("base64"),
      });
      expect(ingest.status).toBe(200);
      expect(ingest.body).toMatchObject({
        deduplicated: false,
        resumed: false,
      });

      const repeated = await postJson("/v1/objects/ingest", {
        workspaceId,
        idempotencyKey: `live-${runId}`,
        mediaType: "text/plain",
        bytesBase64: bytes.toString("base64"),
      });
      expect(repeated.status).toBe(200);
      expect(repeated.body).toMatchObject({ resumed: true });

      const verification = await postJson("/v1/verification/runs", {
        workspaceId,
        level: "full_blob",
      });
      expect(verification.status).toBe(200);
      expect(verification.body).toMatchObject({
        workspaceId,
        level: "full_blob",
        status: "passed",
        objectsChecked: 1,
        bytesRead: bytes.byteLength,
      });

      const uploadBytes = Buffer.from(`live-upload-session-${runId}`);
      const expectedSha256 = sha256(uploadBytes);
      const upload = await postJson("/v1/uploads", {
        workspaceId,
        idempotencyKey: `upload-session-${runId}`,
        mediaType: "text/plain",
        expectedByteLength: uploadBytes.byteLength,
        expectedSha256,
        expiresInSeconds: 300,
      });
      expect(upload.status).toBe(200);
      expect(upload.body).toMatchObject({
        state: "requested",
        status: "pending",
        expectedSha256,
      });
      const uploadId = requiredString(upload.body, "id");
      const uploadOperationId = requiredString(upload.body, "operationId");
      const completedUpload = await postJson(
        `/v1/uploads/${uploadId}/complete`,
        { workspaceId, bytesBase64: uploadBytes.toString("base64") },
      );
      expect(completedUpload.body).toMatchObject({
        state: "completed",
        status: "succeeded",
        blobId: expect.any(String),
      });
      const conflictingReplay = await postJson(
        `/v1/uploads/${uploadId}/complete`,
        {
          workspaceId,
          bytesBase64: Buffer.from("different body").toString("base64"),
        },
      );
      expect(conflictingReplay.status).toBe(422);
      expect(conflictingReplay.body).toMatchObject({
        code: "COMMAND_REJECTED",
      });
      expect(
        (await authorizedGet(`/v1/uploads/${uploadId}`, workspaceId)).body,
      ).toMatchObject({ id: uploadId, state: "completed" });
      expect(
        (
          await authorizedGet(
            `/v1/operations/${uploadOperationId}`,
            workspaceId,
          )
        ).body,
      ).toMatchObject({ id: uploadOperationId, status: "succeeded" });
      const userUploadOperation = (
        await ownerSource.query<{
          requested_by_principal_type: string;
          result_json: { ingestOperationId: string };
        }>(
          "SELECT requested_by_principal_type,result_json FROM operations WHERE id=$1",
          [uploadOperationId],
        )
      ).rows[0]!;
      expect(userUploadOperation.requested_by_principal_type).toBe("user");
      expect(
        (
          await ownerSource.query<{
            requested_by_principal_type: string;
            actor_type: string;
          }>(
            "SELECT o.requested_by_principal_type,a.actor_type FROM operations o JOIN audit_events a ON a.operation_id=o.id WHERE o.id=$1",
            [userUploadOperation.result_json.ingestOperationId],
          )
        ).rows[0],
      ).toEqual({
        requested_by_principal_type: "user",
        actor_type: "user",
      });

      const resourceId = deterministicUuid("diary-main");
      const current = (
        await ownerSource.query<{
          current_revision_id: string;
          dataset_id: string;
          schema_package_id: string;
          schema_version: string;
          canonical_payload_json: Record<string, unknown>;
        }>(
          "SELECT r.current_revision_id,r.dataset_id,v.schema_package_id,v.schema_version,v.canonical_payload_json FROM resources r JOIN revisions v ON v.id=r.current_revision_id WHERE r.id=$1",
          [resourceId],
        )
      ).rows[0]!;
      const scopedVerification = await postJson("/v1/verification/runs", {
        workspaceId: syntheticWorkspaceId,
        level: "resource",
        scope: { kind: "resource", id: resourceId },
      });
      expect(scopedVerification.status).toBe(200);
      expect(scopedVerification.body).toMatchObject({
        workspaceId: syntheticWorkspaceId,
        level: "resource",
        scope: { kind: "resource", id: resourceId },
        objectsChecked: expect.any(Number),
      });
      const scopedReportId = requiredString(scopedVerification.body, "id");
      expect(
        (
          await authorizedGet(
            `/v1/verification/reports/${scopedReportId}`,
            syntheticWorkspaceId,
          )
        ).body,
      ).toEqual(scopedVerification.body);
      expect(
        (
          await ownerSource.query(
            "SELECT id FROM verification_runs WHERE id=$1 AND workspace_id=$2",
            [scopedReportId, syntheticWorkspaceId],
          )
        ).rowCount,
      ).toBe(1);
      for (const path of [
        "/v1/workspaces",
        "/v1/applications",
        "/v1/schemas",
        "/v1/datasets",
        `/v1/datasets/${current.dataset_id}`,
        "/v1/resources",
        `/v1/resources/${resourceId}`,
        `/v1/resources/${resourceId}/revision-graph`,
        "/v1/relations",
        "/v1/deleted-resources",
        "/v1/history",
        "/v1/audit/events",
        "/v1/verification/reports",
        "/v1/health/storage",
        "/v1/health/backup",
      ])
        expect(
          (await authorizedGet(path, syntheticWorkspaceId)).status,
          path,
        ).toBe(200);
      const revision = await postJson(`/v1/resources/${resourceId}/revisions`, {
        workspaceId: syntheticWorkspaceId,
        expectedRevisionId: current.current_revision_id,
        schemaPackageId: current.schema_package_id,
        schemaVersion: current.schema_version,
        canonicalPayload: {
          ...current.canonical_payload_json,
          dockerProof: runId,
        },
        changeNote: "Docker live integration proof",
      });
      expect(revision.status).toBe(200);
      const revisionId = requiredString(revision.body, "revisionId");

      const deleted = await postJson(`/v1/resources/${resourceId}/delete`, {
        workspaceId: syntheticWorkspaceId,
        expectedRevisionId: revisionId,
        recoverUntil: "2026-12-31T00:00:00.000Z",
      });
      expect(deleted.status).toBe(200);
      const restored = await postJson(`/v1/resources/${resourceId}/restore`, {
        workspaceId: syntheticWorkspaceId,
        changeNote: "Docker recovery proof",
      });
      expect(restored.status).toBe(200);
      expect(
        Number(requiredValue(restored.body, "revisionNumber")),
      ).toBeGreaterThan(Number(requiredValue(revision.body, "revisionNumber")));
      expect(
        (
          await ownerSource.query("SELECT id FROM revisions WHERE id=$1", [
            revisionId,
          ])
        ).rowCount,
      ).toBe(1);
    } finally {
      await stopServer(server);
    }
  }, 60_000);

  it("preserves application principals for direct and upload-session ingest", async () => {
    const applicationId = deterministicUuid(`ingest-application-${runId}`);
    const applicationActorId = `ingest.application.${runId}`;
    await ownerSource.query(
      "INSERT INTO application_registrations (id,workspace_id,namespace,name,application_version,capabilities_json) VALUES ($1,$2,$3,'Docker ingest application','1.0.0','[\"object:ingest\"]'::jsonb)",
      [applicationId, workspaceId, applicationActorId],
    );
    await ownerSource.query(
      "INSERT INTO policy_assignments (workspace_id,principal_type,principal_id,role,scope_kind,scope_id,created_by) VALUES ($1,'application',$2,'admin','application',$3,'docker-test')",
      [workspaceId, applicationActorId, applicationId],
    );
    const server = await startServer(
      undefined,
      "application",
      applicationActorId,
    );
    try {
      const directBytes = Buffer.from(`application-direct-${runId}`);
      const direct = await postJson("/v1/objects/ingest", {
        workspaceId,
        idempotencyKey: `application-direct-${runId}`,
        mediaType: "text/plain",
        bytesBase64: directBytes.toString("base64"),
      });
      expect(direct.status).toBe(200);
      const directOperationId = requiredString(direct.body, "operationId");

      const uploadBytes = Buffer.from(`application-upload-${runId}`);
      const upload = await postJson("/v1/uploads", {
        workspaceId,
        idempotencyKey: `application-upload-${runId}`,
        mediaType: "text/plain",
        expectedByteLength: uploadBytes.byteLength,
        expectedSha256: sha256(uploadBytes),
      });
      expect(upload.status).toBe(200);
      const uploadId = requiredString(upload.body, "id");
      const uploadOperationId = requiredString(upload.body, "operationId");
      const completed = await postJson(`/v1/uploads/${uploadId}/complete`, {
        workspaceId,
        bytesBase64: uploadBytes.toString("base64"),
      });
      expect(completed.status).toBe(200);

      const uploadOperation = (
        await ownerSource.query<{
          requested_by_principal_type: string;
          result_json: { ingestOperationId: string };
        }>(
          "SELECT requested_by_principal_type,result_json FROM operations WHERE id=$1",
          [uploadOperationId],
        )
      ).rows[0]!;
      expect(uploadOperation.requested_by_principal_type).toBe("application");
      for (const operationId of [
        directOperationId,
        uploadOperation.result_json.ingestOperationId,
      ]) {
        expect(
          (
            await ownerSource.query<{
              requested_by_principal_type: string;
              actor_type: string;
            }>(
              "SELECT o.requested_by_principal_type,a.actor_type FROM operations o JOIN audit_events a ON a.operation_id=o.id WHERE o.id=$1",
              [operationId],
            )
          ).rows[0],
        ).toEqual({
          requested_by_principal_type: "application",
          actor_type: "application",
        });
      }
    } finally {
      await stopServer(server);
    }
  }, 60_000);

  it("exports and imports a verified PostgreSQL and MinIO archive", async () => {
    const server = await startServer();
    try {
      const exported = await postJson("/v1/portability/exports", {
        workspaceId: weSketchWorkspaceId,
        datasetIds: [weSketchDatasetId],
        idempotencyKey: `portability-export-${runId}`,
      });
      expect(exported.status, JSON.stringify(exported.body)).toBe(200);
      expect(exported.body).toMatchObject({
        workspaceId: weSketchWorkspaceId,
        datasetIds: [weSketchDatasetId],
        status: "ready",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(
        await postJson("/v1/portability/exports", {
          workspaceId: weSketchWorkspaceId,
          datasetIds: [weSketchDatasetId],
          idempotencyKey: `portability-export-${runId}`,
        }),
      ).toEqual(exported);
      const exportId = requiredString(exported.body, "id");
      const downloaded = await authorizedGet(
        `/v1/portability/exports/${exportId}/download`,
        weSketchWorkspaceId,
      );
      expect(downloaded.status).toBe(200);
      const archiveBase64 = requiredString(downloaded.body, "archiveBase64");
      expect(sha256(Buffer.from(archiveBase64, "base64"))).toBe(
        requiredString(exported.body, "sha256"),
      );

      const uploaded = await postJson("/v1/portability/archives", {
        workspaceId,
        idempotencyKey: `portability-upload-${runId}`,
        archiveBase64,
      });
      expect(uploaded.status).toBe(200);
      expect(uploaded.body).toMatchObject({
        workspaceId,
        status: "verified",
        issueCount: 0,
        blobCount: weSketchFixture.blobs.length,
      });
      expect(
        await postJson("/v1/portability/archives", {
          workspaceId,
          idempotencyKey: `portability-upload-${runId}`,
          archiveBase64,
        }),
      ).toEqual(uploaded);
      const archiveId = requiredString(uploaded.body, "id");
      const planned = await postJson("/v1/portability/plans", {
        workspaceId,
        archiveId,
        idempotencyKey: `portability-plan-${runId}`,
        mode: "mapped_workspace",
        conflictMode: "reject_on_error",
      });
      expect(planned.status).toBe(200);
      const persistedPlan = (
        await ownerSource.query<{ plan_json: { issues: unknown[] } }>(
          "SELECT plan_json FROM portability_plans WHERE workspace_id=$1 AND id=$2",
          [workspaceId, requiredString(planned.body, "id")],
        )
      ).rows[0]!;
      expect(
        planned.body,
        JSON.stringify(persistedPlan.plan_json.issues),
      ).toMatchObject({
        workspaceId,
        archiveId,
        status: "ready",
        issueCount: 0,
      });
      const planId = requiredString(planned.body, "id");
      const executed = await postJson(
        `/v1/portability/plans/${planId}/execute`,
        {
          workspaceId,
          idempotencyKey: `portability-execute-${runId}`,
          confirmation: "IMPORT",
        },
      );
      expect(executed.status).toBe(200);
      expect(executed.body).toMatchObject({
        workspaceId,
        planId,
        checkpoint: "completed",
        status: "completed",
      });
      const replayed = await postJson(
        `/v1/portability/plans/${planId}/execute`,
        {
          workspaceId,
          idempotencyKey: `portability-execute-${runId}`,
          confirmation: "IMPORT",
        },
      );
      expect(replayed.body).toMatchObject({
        id: requiredString(executed.body, "id"),
        checkpoint: "completed",
        resumed: true,
      });
      expect(
        (
          await authorizedGet(
            `/v1/portability/operations/${requiredString(executed.body, "id")}`,
            workspaceId,
          )
        ).body,
      ).toMatchObject({
        id: requiredString(executed.body, "id"),
        checkpoint: "completed",
      });
      expect(
        (
          await ownerSource.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM datasets WHERE workspace_id=$1",
            [workspaceId],
          )
        ).rows[0]!.count,
      ).toBe(1);
      expect(
        (
          await ownerSource.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM blob_objects WHERE workspace_id=$1 AND verification_state='verified' AND storage_provider='minio'",
            [workspaceId],
          )
        ).rows[0]!.count,
      ).toBe(weSketchFixture.blobs.length);
    } finally {
      await stopServer(server);
    }
  }, 60_000);

  it("terminates and restarts the API after every ingest effect without corruption", async () => {
    for (const checkpoint of ingestCheckpoints) {
      const idempotencyKey = `${checkpoint}-${runId}`;
      const bytes = Buffer.from(`process-interruption-${checkpoint}-${runId}`);
      const body = {
        workspaceId,
        idempotencyKey,
        mediaType: "text/plain",
        bytesBase64: bytes.toString("base64"),
      };
      const interrupted = await startServer(checkpoint);
      const exited = waitForExit(interrupted);
      await fetch(`${baseUrl}/v1/objects/ingest`, requestOptions(body)).catch(
        () => undefined,
      );
      expect(await exited).toBe(86);
      const interruptedOperation = (
        await ownerSource.query<{ id: string }>(
          "SELECT id FROM operations WHERE workspace_id=$1 AND operation_type='object.ingest' AND idempotency_key=$2",
          [workspaceId, idempotencyKey],
        )
      ).rows[0]!;

      const restarted = await startServer();
      try {
        const result = await postJson("/v1/objects/ingest", body);
        expect(result.status).toBe(200);
        expect(result.body).toMatchObject({
          operationId: interruptedOperation.id,
          resumed: checkpoint !== "authorised",
        });
        const operation = (
          await ownerSource.query<{
            id: string;
            state: string;
            result_json: { checkpoints: string[] };
          }>(
            "SELECT id,state,result_json FROM operations WHERE workspace_id=$1 AND operation_type='object.ingest' AND idempotency_key=$2",
            [workspaceId, idempotencyKey],
          )
        ).rows[0]!;
        expect(operation.state).toBe("completed");
        expect(operation.result_json.checkpoints).toEqual(ingestCheckpoints);
        expect(
          (
            await ownerSource.query(
              "SELECT id FROM audit_events WHERE operation_id=$1",
              [operation.id],
            )
          ).rowCount,
        ).toBe(1);
        expect(
          (
            await ownerSource.query(
              "SELECT id FROM outbox_events WHERE operation_id=$1",
              [operation.id],
            )
          ).rowCount,
        ).toBe(1);
      } finally {
        await stopServer(restarted);
      }
    }
  }, 180_000);
});

async function startServer(
  failureCheckpoint?: string,
  principalType?: "user" | "service" | "application",
  actorId = "docker-admin",
): Promise<ChildProcess> {
  const child = spawn(process.execPath, [tsxCli, "src/server.ts"], {
    cwd: appRoot,
    env: {
      ...process.env,
      DATABASE_URL: appUrl,
      TRUST_ADMIN_TOKEN: adminToken,
      TRUST_ADMIN_ACTOR_ID: actorId,
      ...(principalType
        ? { TRUST_ADMIN_PRINCIPAL_TYPE: principalType }
        : { TRUST_ADMIN_PRINCIPAL_TYPE: "" }),
      TRUST_WORKSPACE_KEY: workspaceKey,
      TRUST_FIXTURE_WORKSPACE_IDS: `${syntheticWorkspaceId},${weSketchWorkspaceId}`,
      TRUST_API_PORT: String(port),
      TRUST_STORAGE_ENDPOINT: endpoint,
      TRUST_STORAGE_REGION: process.env.TRUST_STORAGE_REGION ?? "us-east-1",
      TRUST_STORAGE_BUCKET: bucket,
      TRUST_STORAGE_ACCESS_KEY: accessKeyId,
      TRUST_STORAGE_SECRET_KEY: secretAccessKey,
      TRUST_STORAGE_FORCE_PATH_STYLE: "true",
      TRUST_ALLOW_LOCAL_UNSIGNED_ARCHIVES: "true",
      ...(failureCheckpoint
        ? { TRUST_FAIL_AFTER_CHECKPOINT: failureCheckpoint }
        : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", () => undefined);
  child.stderr?.on("data", () => undefined);
  await waitForHealth(child);
  return child;
}

async function waitForHealth(child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`Trust API exited during startup with ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // Startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Trust API did not become healthy in time");
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = waitForExit(child);
  child.kill();
  await exited;
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
}

async function getJson(path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}${path}`);
  expect(response.status).toBe(200);
  return response.json() as Promise<Record<string, unknown>>;
}

async function postJson(
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, requestOptions(body));
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

async function authorizedGet(
  path: string,
  workspaceId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      authorization: `Bearer ${adminToken}`,
      "x-trust-workspace-id": workspaceId,
      "x-trust-reauth": adminToken,
    },
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

function requestOptions(body: Record<string, unknown>): RequestInit {
  return {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
      "x-trust-reauth": adminToken,
    },
    body: JSON.stringify(body),
  };
}

function requiredValue(value: Record<string, unknown>, key: string): unknown {
  if (!(key in value)) throw new Error(`Response is missing ${key}`);
  return value[key];
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const result = requiredValue(value, key);
  if (typeof result !== "string")
    throw new Error(`Response ${key} is not a string`);
  return result;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function deleteRunObjects(): Promise<void> {
  let continuationToken: string | undefined;
  do {
    const listed = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `workspaces/${workspaceId}/`,
        ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
      }),
    );
    const objects =
      listed.Contents?.flatMap(({ Key }) => (Key ? [{ Key }] : [])) ?? [];
    if (objects.length > 0) {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: objects },
        }),
      );
    }
    continuationToken = listed.IsTruncated
      ? listed.NextContinuationToken
      : undefined;
  } while (continuationToken);
  await s3.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: weSketchFixture.blobs.map(({ storageKey }) => ({
          Key: storageKey,
        })),
      },
    }),
  );
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
