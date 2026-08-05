import { canonicalJson, sha256 } from "./canonical.js";
import { assertSafeArchivePath, blobArchivePath } from "./paths.js";
import {
  archiveRecordKinds,
  type ArchiveEntrySet,
  type ArchiveRecord,
  type ArchiveRecordKind,
  type ArchiveSource,
  type TrustArchiveManifest,
} from "./types.js";

const encoder = new TextEncoder();

export function assembleArchiveEntries(source: ArchiveSource): ArchiveEntrySet {
  const entries = new Map<string, Uint8Array>();
  const recordCounts = Object.fromEntries(
    archiveRecordKinds.map((kind) => [kind, source.records[kind]?.length ?? 0]),
  ) as Record<ArchiveRecordKind, number>;
  const blobs = [...(source.blobs ?? [])].sort((a, b) =>
    a.sha256.localeCompare(b.sha256),
  );
  for (const blob of blobs) {
    if (blob.bytes.byteLength !== blob.byteLength)
      throw new Error(`Blob ${blob.sha256} byte length does not match.`);
    if (sha256(blob.bytes) !== blob.sha256)
      throw new Error(`Blob ${blob.sha256} digest does not match.`);
    add(entries, blobArchivePath(blob.sha256), blob.bytes);
  }
  for (const kind of archiveRecordKinds) {
    const records = source.records[kind] ?? [];
    if (records.length === 0) continue;
    const lines = [...records]
      .sort(compareRecords)
      .map(canonicalJson)
      .join("\n");
    add(entries, `records/${kind}.jsonl`, encoder.encode(`${lines}\n`));
  }
  const manifest: TrustArchiveManifest = {
    format: "trustarchive",
    formatVersion: "0.2",
    exportId: source.exportId,
    workspaceId: source.workspaceId,
    datasetIds: [...source.datasetIds].sort(),
    createdAt: source.createdAt,
    createdBy: source.createdBy,
    sourceVersion: source.sourceVersion,
    checksumAlgorithm: "sha256",
    canonicalJsonProfile: "trust-core-canonical-json-v1",
    signatureProfile: "unsigned",
    auditLineage: auditLineage(source),
    recordCounts,
    blobCount: blobs.length,
    totalBlobBytes: blobs.reduce((total, blob) => total + blob.byteLength, 0),
  };
  add(entries, "manifest.json", encoder.encode(`${canonicalJson(manifest)}\n`));
  add(
    entries,
    "README.txt",
    encoder.encode(
      "Trust Core portable archive\nVerify checksums before reading or importing records.\n",
    ),
  );
  const sums = [...entries]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, bytes]) => `${sha256(bytes)}  ${path}`)
    .join("\n");
  add(entries, "checksums/sha256sums.txt", encoder.encode(`${sums}\n`));
  return { entries, manifest };
}

function auditLineage(
  source: ArchiveSource,
): TrustArchiveManifest["auditLineage"] {
  const events = source.records["audit-events"] ?? [];
  const hashes = events
    .map((event) => event.eventHash)
    .filter((value): value is string => typeof value === "string");
  const referenced = new Set(
    events
      .map((event) => event.previousEventHash)
      .filter((value): value is string => typeof value === "string"),
  );
  return {
    mode: "source_chain",
    sourceWorkspaceId: source.workspaceId,
    eventCount: events.length,
    firstEventHash:
      (events.find(
        (event) =>
          event.previousEventHash === null ||
          event.previousEventHash === undefined,
      )?.eventHash as string | undefined) ?? null,
    lastEventHash: hashes.find((hash) => !referenced.has(hash)) ?? null,
  };
}

function add(
  entries: Map<string, Uint8Array>,
  path: string,
  bytes: Uint8Array,
) {
  assertSafeArchivePath(path);
  if (entries.has(path)) throw new Error(`Duplicate archive path: ${path}`);
  entries.set(path, Uint8Array.from(bytes));
}

function compareRecords(left: ArchiveRecord, right: ArchiveRecord): number {
  const leftId = typeof left.id === "string" ? left.id : canonicalJson(left);
  const rightId =
    typeof right.id === "string" ? right.id : canonicalJson(right);
  return leftId.localeCompare(rightId);
}
