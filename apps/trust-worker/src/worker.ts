import { hostname } from "node:os";
import { Pool } from "pg";
import {
  PostgresOutboxStore,
  PostgresReconciliationCatalog,
  type DatabasePool,
  type QueryResult,
  type TransactionClient,
} from "@trust-core/persistence-postgres";
import {
  ReconciliationWorker,
  createReconciliationHandlers,
} from "@trust-core/reconciliation";
import { MinioObjectStorage } from "@trust-core/storage-minio";
import { S3ObjectStorage } from "@trust-core/storage-s3";
import type { ObjectStorage } from "@trust-core/storage";

const databaseUrl = required("DATABASE_URL");
const poolSource = new Pool({ connectionString: databaseUrl, max: 5 });
const pool = adaptPool(poolSource);
const storage = createStorage();
const workspaceId = process.env.TRUST_WORKSPACE_ID;
const worker = new ReconciliationWorker(
  new PostgresOutboxStore(pool),
  createReconciliationHandlers(
    storage,
    new PostgresReconciliationCatalog(pool),
  ),
  {
    workerId: `${hostname()}:${process.pid}`,
    ...(workspaceId ? { workspaceId } : {}),
    maxAttempts: Number(process.env.TRUST_WORKER_MAX_ATTEMPTS ?? 5),
    batchSize: Number(process.env.TRUST_WORKER_BATCH_SIZE ?? 25),
    leaseMs: Number(process.env.TRUST_WORKER_LEASE_MS ?? 30_000),
    concurrency: Number(process.env.TRUST_WORKER_CONCURRENCY ?? 4),
  },
);

async function run() {
  const result = await worker.runOnce();
  process.stdout.write(
    `${JSON.stringify({ at: new Date().toISOString(), ...result })}\n`,
  );
}

if (process.argv.includes("--once")) {
  await run();
  await pool.end();
} else {
  const interval = Number(process.env.TRUST_WORKER_INTERVAL_MS ?? 5_000);
  let stopping = false;
  let inFlight: Promise<void> | undefined;
  let timer: NodeJS.Timeout | undefined;
  const loop = async () => {
    if (stopping) return;
    inFlight = run().catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.stack : String(error)}\n`,
      );
    });
    await inFlight;
    inFlight = undefined;
    if (!stopping) timer = setTimeout(() => void loop(), interval);
  };
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    if (timer) clearTimeout(timer);
    await inFlight;
    await pool.end();
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
  await loop();
}

function createStorage(): ObjectStorage {
  const provider = (process.env.TRUST_STORAGE_PROVIDER ?? "minio")
    .trim()
    .toLowerCase();
  const region = process.env.TRUST_STORAGE_REGION ?? "us-east-1";
  const bucket = required("TRUST_STORAGE_BUCKET");
  if (provider === "s3" || provider === "aws") {
    const endpoint = process.env.TRUST_STORAGE_ENDPOINT;
    const accessKeyId = process.env.TRUST_STORAGE_ACCESS_KEY;
    const secretAccessKey = process.env.TRUST_STORAGE_SECRET_KEY;
    const sessionToken = process.env.TRUST_STORAGE_SESSION_TOKEN;
    if ((accessKeyId === undefined) !== (secretAccessKey === undefined)) {
      throw new Error(
        "S3 static credentials require both TRUST_STORAGE_ACCESS_KEY and TRUST_STORAGE_SECRET_KEY",
      );
    }
    return new S3ObjectStorage({
      region,
      bucket,
      forcePathStyle: process.env.TRUST_STORAGE_FORCE_PATH_STYLE === "true",
      ...(endpoint ? { endpoint } : {}),
      ...(accessKeyId && secretAccessKey
        ? {
            accessKeyId,
            secretAccessKey,
            ...(sessionToken ? { sessionToken } : {}),
          }
        : {}),
    });
  }
  if (provider !== "minio" && provider !== "") {
    throw new Error(
      `Unknown TRUST_STORAGE_PROVIDER "${provider}". Expected minio or s3.`,
    );
  }
  return new MinioObjectStorage({
    endpoint: required("TRUST_STORAGE_ENDPOINT"),
    region,
    bucket,
    accessKeyId: required("TRUST_STORAGE_ACCESS_KEY"),
    secretAccessKey: required("TRUST_STORAGE_SECRET_KEY"),
    forcePathStyle: process.env.TRUST_STORAGE_FORCE_PATH_STYLE !== "false",
  });
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
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
