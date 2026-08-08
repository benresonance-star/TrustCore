import { createHash } from "node:crypto";
import type {
  ArchiveBlobInput,
  ArchiveRecord,
  ArchiveSource,
} from "@trust-core/archive";
import type { ObjectStorage } from "@trust-core/storage";
import type { DatabasePool, Queryable } from "./db.js";

const maxBlobBytes = 4_000_000;
const maxTotalBlobBytes = 16_000_000;

interface JsonRow {
  readonly record: Record<string, unknown>;
}

interface BlobRow {
  readonly id: string;
  readonly sha256: string;
  readonly byte_length: string | number;
  readonly storage_provider: string;
  readonly storage_key: string;
}

export class PostgresPortabilityExportReader {
  constructor(
    private readonly pool: DatabasePool,
    private readonly storage: ObjectStorage,
    private readonly storageProvider: string,
  ) {}

  async read(input: {
    exportId: string;
    workspaceId: string;
    datasetIds: readonly string[];
    createdAt: string;
    createdBy: string;
  }): Promise<ArchiveSource> {
    const datasetIds = [...new Set(input.datasetIds)].sort();
    if (datasetIds.length === 0)
      throw codedError("INVALID_COMMAND", "At least one dataset is required.");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await client.query("SELECT set_config('trust.workspace_id',$1,true)", [
        input.workspaceId,
      ]);
      await client.query("SELECT set_config('trust.dataset_ids',$1,true)", [
        datasetIds.join(","),
      ]);
      const workspace = await records(
        client,
        "SELECT to_jsonb(w) AS record FROM workspaces w WHERE w.id=$1",
        [input.workspaceId],
      );
      if (workspace.length !== 1)
        throw codedError(
          "DATASET_NOT_FOUND",
          "Export workspace was not found.",
        );
      const datasets = await records(
        client,
        "SELECT to_jsonb(d) AS record FROM datasets d WHERE d.workspace_id=$1 AND d.id=ANY($2::uuid[]) ORDER BY d.id",
        [input.workspaceId, datasetIds],
      );
      if (datasets.length !== datasetIds.length)
        throw codedError(
          "DATASET_NOT_FOUND",
          "A selected dataset is missing or belongs to another workspace.",
        );
      const retention = await records(
        client,
        "SELECT to_jsonb(p) AS record FROM retention_policies p WHERE p.workspace_id=$1 AND p.id IN (SELECT d.retention_policy_id FROM datasets d WHERE d.workspace_id=$1 AND d.id=ANY($2::uuid[]) AND d.retention_policy_id IS NOT NULL) ORDER BY p.id",
        [input.workspaceId, datasetIds],
      );
      const resources = await records(
        client,
        "SELECT to_jsonb(r) AS record FROM resources r WHERE r.workspace_id=$1 AND r.dataset_id=ANY($2::uuid[]) ORDER BY r.id",
        [input.workspaceId, datasetIds],
      );
      const revisions = await records(
        client,
        "SELECT to_jsonb(v) AS record FROM revisions v WHERE v.workspace_id=$1 AND v.dataset_id=ANY($2::uuid[]) ORDER BY v.id",
        [input.workspaceId, datasetIds],
      );
      const revisionBlobs = await records(
        client,
        "SELECT to_jsonb(rb) AS record FROM revision_blobs rb JOIN revisions v ON v.id=rb.revision_id AND v.workspace_id=rb.workspace_id WHERE rb.workspace_id=$1 AND v.dataset_id=ANY($2::uuid[]) ORDER BY rb.id",
        [input.workspaceId, datasetIds],
      );
      const blobRows = await client.query<BlobRow>(
        "SELECT DISTINCT b.id::text,b.sha256,b.byte_length,b.storage_provider,b.storage_key FROM blob_objects b JOIN revision_blobs rb ON rb.blob_object_id=b.id AND rb.workspace_id=b.workspace_id JOIN revisions v ON v.id=rb.revision_id AND v.workspace_id=rb.workspace_id WHERE b.workspace_id=$1 AND v.dataset_id=ANY($2::uuid[])",
        [input.workspaceId, datasetIds],
      );
      const blobRecords = await records(
        client,
        "SELECT DISTINCT to_jsonb(b) AS record FROM blob_objects b JOIN revision_blobs rb ON rb.blob_object_id=b.id AND rb.workspace_id=b.workspace_id JOIN revisions v ON v.id=rb.revision_id AND v.workspace_id=rb.workspace_id WHERE b.workspace_id=$1 AND v.dataset_id=ANY($2::uuid[])",
        [input.workspaceId, datasetIds],
      );
      if (blobRows.rows.length !== blobRecords.length)
        throw new Error("Export blob metadata selection is inconsistent.");
      const declaredBlobBytes = blobRows.rows.map((row) => declaredLength(row));
      if (
        declaredBlobBytes.some((value) => value > maxBlobBytes) ||
        declaredBlobBytes.reduce((total, value) => total + value, 0) >
          maxTotalBlobBytes
      )
        throw codedError(
          "REQUEST_TOO_LARGE",
          "Selected blob bytes exceed the bounded 0.2H archive limits.",
        );
      const schemas = await records(
        client,
        "SELECT DISTINCT to_jsonb(s) AS record FROM schema_packages s WHERE s.id IN (SELECT d.schema_package_id FROM datasets d WHERE d.workspace_id=$1 AND d.id=ANY($2::uuid[]) UNION SELECT v.schema_package_id FROM revisions v WHERE v.workspace_id=$1 AND v.dataset_id=ANY($2::uuid[]))",
        [input.workspaceId, datasetIds],
      );
      const relations = await records(
        client,
        "SELECT to_jsonb(r) AS record FROM relations r WHERE r.workspace_id=$1 AND r.dataset_id=ANY($2::uuid[]) ORDER BY r.id",
        [input.workspaceId, datasetIds],
      );
      const tombstones = await records(
        client,
        "SELECT to_jsonb(t) AS record FROM tombstones t WHERE t.workspace_id=$1 AND t.dataset_id=ANY($2::uuid[]) ORDER BY t.id",
        [input.workspaceId, datasetIds],
      );
      const auditEvents = await records(
        client,
        "SELECT to_jsonb(a) AS record FROM audit_events a WHERE a.workspace_id=$1 ORDER BY a.occurred_at,a.id",
        [input.workspaceId],
      );
      assertReferences({
        datasets,
        retention,
        resources,
        revisions,
        revisionBlobs,
        blobRecords,
        schemas,
        relations,
      });
      const blobs = await Promise.all(
        blobRows.rows.map((row) => this.readBlob(row)),
      );
      await client.query("COMMIT");
      return {
        exportId: input.exportId,
        workspaceId: input.workspaceId,
        datasetIds,
        createdAt: input.createdAt,
        createdBy: input.createdBy,
        sourceVersion: "0.3",
        records: {
          workspaces: workspace,
          "schema-packages": schemas,
          retention,
          datasets,
          resources,
          revisions,
          "revision-blobs": revisionBlobs,
          blobs: blobRecords,
          relations,
          tombstones,
          "audit-events": auditEvents,
        },
        blobs,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async readBlob(row: BlobRow): Promise<ArchiveBlobInput> {
    if (row.storage_provider !== this.storageProvider)
      throw new Error("Export blob belongs to a different storage provider.");
    const expectedLength = declaredLength(row);
    const stream = await this.storage.openReadStream({ key: row.storage_key });
    const hash = createHash("sha256");
    const chunks: Buffer[] = [];
    let byteLength = 0;
    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk);
      byteLength += bytes.byteLength;
      hash.update(bytes);
      chunks.push(bytes);
    }
    if (byteLength !== expectedLength || hash.digest("hex") !== row.sha256)
      throw new Error("Export blob bytes do not match PostgreSQL metadata.");
    return {
      sha256: row.sha256,
      byteLength,
      bytes: Buffer.concat(chunks),
    };
  }
}

function declaredLength(row: BlobRow): number {
  const value = Number(row.byte_length);
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Export blob has an invalid byte length.");
  return value;
}

async function records(
  db: Queryable,
  text: string,
  values: readonly unknown[],
): Promise<ArchiveRecord[]> {
  const result = await db.query<JsonRow>(text, values);
  return result.rows.map(({ record }) => camelizeRecord(record));
}

function camelizeRecord(
  record: Readonly<Record<string, unknown>>,
): ArchiveRecord {
  const logicalNames: Readonly<Record<string, string>> = {
    manifest_json: "manifest",
    canonical_payload_json: "canonicalPayload",
    metadata_json: "metadata",
    extensions_json: "extensions",
  };
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => {
      const logicalKey =
        logicalNames[key] ??
        key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
      return [logicalKey, normalizeValue(logicalKey, value)];
    }),
  );
}

function normalizeValue(key: string, value: unknown): unknown {
  if (
    typeof value === "string" &&
    (key.endsWith("At") ||
      key.endsWith("Until") ||
      key === "occurredAt" ||
      key === "importedAt")
  ) {
    const timestamp = new Date(value);
    if (!Number.isNaN(timestamp.valueOf())) return timestamp.toISOString();
  }
  return value;
}

function assertReferences(input: {
  datasets: readonly ArchiveRecord[];
  retention: readonly ArchiveRecord[];
  resources: readonly ArchiveRecord[];
  revisions: readonly ArchiveRecord[];
  revisionBlobs: readonly ArchiveRecord[];
  blobRecords: readonly ArchiveRecord[];
  schemas: readonly ArchiveRecord[];
  relations: readonly ArchiveRecord[];
}): void {
  const schemas = ids(input.schemas);
  const retention = ids(input.retention);
  const datasets = ids(input.datasets);
  const resources = ids(input.resources);
  const revisions = ids(input.revisions);
  const blobs = ids(input.blobRecords);
  for (const dataset of input.datasets)
    assertReference(schemas, dataset.schemaPackageId, "dataset schema package");
  for (const dataset of input.datasets)
    if (typeof dataset.retentionPolicyId === "string")
      assertReference(
        retention,
        dataset.retentionPolicyId,
        "dataset retention policy",
      );
  for (const resource of input.resources)
    assertReference(datasets, resource.datasetId, "resource dataset");
  for (const revision of input.revisions) {
    assertReference(datasets, revision.datasetId, "revision dataset");
    assertReference(resources, revision.resourceId, "revision resource");
    assertReference(
      schemas,
      revision.schemaPackageId,
      "revision schema package",
    );
  }
  for (const attachment of input.revisionBlobs) {
    assertReference(revisions, attachment.revisionId, "attachment revision");
    assertReference(blobs, attachment.blobObjectId, "attachment blob");
  }
  for (const relation of input.relations) {
    assertRelationReference(relation.sourceKind, relation.sourceId, {
      resources,
      revisions,
      blobs,
    });
    assertRelationReference(relation.targetKind, relation.targetId, {
      resources,
      revisions,
      blobs,
    });
  }
}

function ids(records: readonly ArchiveRecord[]): ReadonlySet<string> {
  return new Set(
    records.flatMap((record) =>
      typeof record.id === "string" ? [record.id] : [],
    ),
  );
}

function assertReference(
  values: ReadonlySet<string>,
  value: unknown,
  description: string,
): void {
  if (typeof value !== "string" || !values.has(value))
    throw new Error(`Export is missing referenced ${description}.`);
}

function assertRelationReference(
  kind: unknown,
  value: unknown,
  idsByKind: {
    readonly resources: ReadonlySet<string>;
    readonly revisions: ReadonlySet<string>;
    readonly blobs: ReadonlySet<string>;
  },
): void {
  if (kind === "external") return;
  const ids =
    kind === "resource"
      ? idsByKind.resources
      : kind === "revision"
        ? idsByKind.revisions
        : kind === "blob"
          ? idsByKind.blobs
          : undefined;
  if (!ids || typeof value !== "string" || !ids.has(value))
    throw codedError(
      "EXPORT_DEPENDENCY_OUTSIDE_SELECTION",
      "Selected datasets contain a relation to an unselected dataset.",
    );
}

function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}
