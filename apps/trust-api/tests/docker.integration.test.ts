import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { createIvansDiaryFixture, ivansDiarySchema } from "@trust-core/fixtures-ivans-diary";
import {
  PostgresTrustRepository,
  deterministicUuid,
  runMigrations,
  type DatabasePool,
  type QueryResult,
  type TransactionClient,
} from "@trust-core/persistence-postgres";
import { ingestCheckpoints } from "@trust-core/operations";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.TRUST_DOCKER_TESTS === "1";
const bootstrapUrl = process.env.POSTGRES_ADMIN_URL
  ?? "postgresql://trust_admin:trust_admin_local_only@localhost:54329/trust_core";
const databaseName = "trust_core_api_docker_test";
const ownerUrl = `postgresql://trust_admin:trust_admin_local_only@localhost:54329/${databaseName}`;
const appUrl = `postgresql://trust_app_local:trust_app_local_only@localhost:54329/${databaseName}`;
const endpoint = process.env.TRUST_STORAGE_ENDPOINT ?? "http://localhost:5900";
const bucket = process.env.TRUST_STORAGE_BUCKET ?? "trust-core-local";
const accessKeyId = process.env.TRUST_STORAGE_ACCESS_KEY ?? "trustcore";
const secretAccessKey = process.env.TRUST_STORAGE_SECRET_KEY ?? "trustcore-local-secret";
const appRoot = fileURLToPath(new URL("../", import.meta.url));
const migrationsDirectory = fileURLToPath(new URL("../../../migrations/", import.meta.url));
const tsxCli = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));
const runId = randomUUID();
const workspaceKey = `docker-process-${runId}`;
const workspaceId = deterministicUuid(workspaceKey);
const syntheticWorkspaceId = deterministicUuid(createIvansDiaryFixture().workspace.id);
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
    await bootstrap.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await bootstrap.query(`CREATE DATABASE ${databaseName}`);
    await runMigrations(owner, migrationsDirectory);
    await ownerSource.query(await readFile(new URL("../../../migrations/provisioning.sql", import.meta.url), "utf8"));
    await new PostgresTrustRepository(owner).seedSyntheticIvan(ivansDiarySchema, createIvansDiaryFixture());
    await ownerSource.query(
      "INSERT INTO workspaces (id,name,slug) VALUES ($1,'Docker process proof',$2)",
      [workspaceId, workspaceKey],
    );
  }, 60_000);

  afterAll(async () => {
    await deleteRunObjects();
    s3.destroy();
    await ownerSource.end();
    await bootstrap.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await bootstrap.end();
  }, 60_000);

  it("proves live health, ingest, full verification, revision, deletion, and restoration", async () => {
    const server = await startServer();
    try {
      const health = await getJson("/health");
      expect(health).toMatchObject({ service: "trust-api", status: "ok", mode: "live" });

      const bytes = Buffer.from(`live-api-${runId}`);
      const ingest = await postJson("/v1/objects/ingest", {
        workspaceId,
        idempotencyKey: `live-${runId}`,
        mediaType: "text/plain",
        bytesBase64: bytes.toString("base64"),
      });
      expect(ingest.status).toBe(200);
      expect(ingest.body).toMatchObject({ deduplicated: false, resumed: false });

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

      const resourceId = deterministicUuid("diary-main");
      const current = (await ownerSource.query<{
        current_revision_id: string;
        schema_package_id: string;
        schema_version: string;
        canonical_payload_json: Record<string, unknown>;
      }>(
        "SELECT r.current_revision_id,v.schema_package_id,v.schema_version,v.canonical_payload_json FROM resources r JOIN revisions v ON v.id=r.current_revision_id WHERE r.id=$1",
        [resourceId],
      )).rows[0]!;
      const revision = await postJson(`/v1/resources/${resourceId}/revisions`, {
        workspaceId: syntheticWorkspaceId,
        expectedRevisionId: current.current_revision_id,
        schemaPackageId: current.schema_package_id,
        schemaVersion: current.schema_version,
        canonicalPayload: { ...current.canonical_payload_json, dockerProof: runId },
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
      expect(Number(requiredValue(restored.body, "revisionNumber"))).toBeGreaterThan(
        Number(requiredValue(revision.body, "revisionNumber")),
      );
      expect((await ownerSource.query("SELECT id FROM revisions WHERE id=$1", [revisionId])).rowCount).toBe(1);
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
      await fetch(`${baseUrl}/v1/objects/ingest`, requestOptions(body)).catch(() => undefined);
      expect(await exited).toBe(86);
      const interruptedOperation = (await ownerSource.query<{ id: string }>(
        "SELECT id FROM operations WHERE workspace_id=$1 AND operation_type='object.ingest' AND idempotency_key=$2",
        [workspaceId, idempotencyKey],
      )).rows[0]!;

      const restarted = await startServer();
      try {
        const result = await postJson("/v1/objects/ingest", body);
        expect(result.status).toBe(200);
        expect(result.body).toMatchObject({
          operationId: interruptedOperation.id,
          resumed: checkpoint !== "authorised",
        });
        const operation = (await ownerSource.query<{
          id: string;
          state: string;
          result_json: { checkpoints: string[] };
        }>(
          "SELECT id,state,result_json FROM operations WHERE workspace_id=$1 AND operation_type='object.ingest' AND idempotency_key=$2",
          [workspaceId, idempotencyKey],
        )).rows[0]!;
        expect(operation.state).toBe("completed");
        expect(operation.result_json.checkpoints).toEqual(ingestCheckpoints);
        expect((await ownerSource.query("SELECT id FROM audit_events WHERE operation_id=$1", [operation.id])).rowCount).toBe(1);
        expect((await ownerSource.query("SELECT id FROM outbox_events WHERE operation_id=$1", [operation.id])).rowCount).toBe(1);
      } finally {
        await stopServer(restarted);
      }
    }
  }, 180_000);
});

async function startServer(failureCheckpoint?: string): Promise<ChildProcess> {
  const child = spawn(process.execPath, [tsxCli, "src/server.ts"], {
    cwd: appRoot,
    env: {
      ...process.env,
      DATABASE_URL: appUrl,
      TRUST_ADMIN_TOKEN: adminToken,
      TRUST_ADMIN_ACTOR_ID: "docker-admin",
      TRUST_WORKSPACE_KEY: workspaceKey,
      TRUST_FIXTURE_WORKSPACE_ID: syntheticWorkspaceId,
      TRUST_API_PORT: String(port),
      TRUST_STORAGE_ENDPOINT: endpoint,
      TRUST_STORAGE_REGION: process.env.TRUST_STORAGE_REGION ?? "us-east-1",
      TRUST_STORAGE_BUCKET: bucket,
      TRUST_STORAGE_ACCESS_KEY: accessKeyId,
      TRUST_STORAGE_SECRET_KEY: secretAccessKey,
      TRUST_STORAGE_FORCE_PATH_STYLE: "true",
      ...(failureCheckpoint ? { TRUST_FAIL_AFTER_CHECKPOINT: failureCheckpoint } : {}),
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
    if (child.exitCode !== null) throw new Error(`Trust API exited during startup with ${child.exitCode}`);
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
    body: await response.json() as Record<string, unknown>,
  };
}

function requestOptions(body: Record<string, unknown>): RequestInit {
  return {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json",
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
  if (typeof result !== "string") throw new Error(`Response ${key} is not a string`);
  return result;
}

async function deleteRunObjects(): Promise<void> {
  let continuationToken: string | undefined;
  do {
    const listed = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: `workspaces/${workspaceId}/`,
      ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
    }));
    const objects = listed.Contents?.flatMap(({ Key }) => Key ? [{ Key }] : []) ?? [];
    if (objects.length > 0) {
      await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects } }));
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
}

function adaptPool(source: Pool): DatabasePool {
  const query = async <Row>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> => {
    const result = await source.query(text, values ? [...values] : undefined);
    return { rows: result.rows as Row[], rowCount: result.rowCount };
  };
  return {
    query,
    async connect() {
      const client = await source.connect();
      return {
        query: async <Row>(text: string, values?: readonly unknown[]) => {
          const result = await client.query(text, values ? [...values] : undefined);
          return { rows: result.rows as Row[], rowCount: result.rowCount };
        },
        release: () => client.release(),
      } satisfies TransactionClient;
    },
    end: () => source.end(),
  };
}
