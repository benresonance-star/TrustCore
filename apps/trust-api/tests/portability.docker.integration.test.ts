import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  archiveImportCheckpoints,
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
const targetWorkspaces = archiveImportCheckpoints.map((checkpoint) =>
  deterministicUuid(`portability-target-${scope.runId}-${checkpoint}`),
);
const finalIvanTarget = targetWorkspaces[0]!;
const finalSketchTarget = targetWorkspaces[1]!;
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
      action: string;
      metadata_json: unknown;
    }>(
      "SELECT action,metadata_json FROM audit_events WHERE workspace_id=ANY($1::uuid[]) AND action='archive.exported'",
      [sourceWorkspaces],
    );
    expect(sourceAudit.rowCount).toBe(2);

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

    const viewerOutput = resolve(temp, "offline.html");
    expect(
      await processExit(process.execPath, [
        tsxCli,
        viewerCli,
        resolve(temp, "1.trustarchive"),
        "--output",
        viewerOutput,
      ]),
    ).toBe(0);
    expect(await readFile(viewerOutput, "utf8")).toContain("Trust Archive");
    expect(await processExit(process.execPath, [tsxCli, viewerCli])).toBe(2);

    await createBucket(scope.targetBucket);
    await createDatabase(scope.targetDatabase);
    targetOwner = ownerPool(scope.targetDatabase);
    await provision(targetOwner);
    for (const [index, workspaceId] of targetWorkspaces.entries())
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
    }
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
    expect(
      (
        await fetch(`${baseUrl}/v1/portability/archives`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workspaceId: finalSketchTarget,
            idempotencyKey: "unauthenticated",
            archiveBase64: sketchBytes.toString("base64"),
          }),
        })
      ).status,
    ).toBe(401);
    expect(
      (await get("/v1/resources", deterministicUuid("unassigned-workspace")))
        .status,
    ).toBe(403);

    for (let index = 0; index < archiveImportCheckpoints.length; index += 1) {
      const checkpoint = archiveImportCheckpoints[index]!;
      const workspaceId = targetWorkspaces[index]!;
      const sourceBytes =
        index === 0
          ? archives.get(sourceWorkspaces[0]!)!
          : archives.get(sourceWorkspaces[1]!)!;
      const preparedImport = await uploadAndPlan(
        workspaceId,
        await validArchiveVariant(sourceBytes, index),
        index,
      );
      process.stdout.write(`[0.2H] interrupting after ${checkpoint}\n`);
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
        resumed: checkpoint !== "authorised",
      });
      const duplicate = await post(
        `/v1/portability/plans/${preparedImport.planId}/execute`,
        preparedImport.workspaceId,
        preparedImport.command,
      );
      expect(duplicate.body).toMatchObject({
        id: stringField(resumed.body, "id"),
        checkpoint: "completed",
        resumed: true,
      });
      const operationCount = await targetOwner.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM portability_import_operations WHERE workspace_id=$1 AND plan_id=$2",
        [preparedImport.workspaceId, preparedImport.planId],
      );
      expect(operationCount.rows[0]!.count).toBe(1);
    }

    await assertFixtureVisible(finalIvanTarget, ivan);
    await assertFixtureVisible(finalSketchTarget, sketch);
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
        "archive.imported",
        "archive.import.executed",
      ]),
    );
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
  }, 360_000);
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
  ): Promise<[string, Buffer]> => {
    const entries = new Map(parsed.entries);
    const manifest = JSON.parse(
      Buffer.from(entries.get("manifest.json")!).toString("utf8"),
    ) as Record<string, unknown>;
    update(entries, manifest);
    entries.set("manifest.json", Buffer.from(JSON.stringify(manifest)));
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
  const content = await mutate("content", (entries) => {
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
  );
  const invalidSignatureArtifact = await mutate(
    "invalid-signature-artifact",
    (entries) => entries.set("signatures/unsigned.sig", Buffer.from("invalid")),
  );
  const pathTraversal = Buffer.from(bytes);
  replaceAll(pathTraversal, "manifest.json", "../evil.jsonx");
  return [
    checksum,
    content,
    missingBlob,
    unsupportedSignature,
    invalidSignatureArtifact,
    ["path-traversal", pathTraversal],
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
  const sums = [...entries]
    .filter(([path]) => path !== "checksums/sha256sums.txt")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, value]) => `${sha256(value)}  ${path}`)
    .join("\n");
  entries.set("checksums/sha256sums.txt", Buffer.from(`${sums}\n`));
  return Buffer.from(
    await writeTrustArchive({ entries, manifest: parsed.manifest }),
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
      TRUST_ADMIN_TOKEN: token,
      TRUST_ADMIN_ACTOR_ID: actor,
      TRUST_WORKSPACE_KEY: `portability-${scope.runId}`,
      TRUST_FIXTURE_WORKSPACE_IDS: [
        ...sourceWorkspaces,
        ...targetWorkspaces,
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

async function processExit(file: string, args: readonly string[]) {
  return new Promise<number | null>((resolvePromise, reject) => {
    const child = spawn(file, args, { cwd: root, stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", resolvePromise);
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

async function get(path: string, workspaceId: string) {
  const options = {
    headers: {
      authorization: `Bearer ${token}`,
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
