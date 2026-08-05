import { canonicalJson, sha256 } from "./canonical.js";
import { assertSafeArchivePath, blobArchivePath } from "./paths.js";
import {
  archiveRecordKinds,
  type ArchiveEntrySet,
  type ArchiveIssue,
  type ArchiveRecord,
  type ArchiveRecordKind,
  type ArchiveVerificationReport,
  type TrustArchiveManifest,
} from "./types.js";

const decoder = new TextDecoder("utf-8", { fatal: true });

export interface ArchiveVerificationLimits {
  readonly maxEntries: number;
  readonly maxEntryBytes: number;
  readonly maxTotalBytes: number;
}

const defaults: ArchiveVerificationLimits = {
  maxEntries: 100_000,
  maxEntryBytes: 2 * 1024 * 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024 * 1024,
};

export function verifyArchiveEntries(
  archive: Pick<ArchiveEntrySet, "entries">,
  limits: Partial<ArchiveVerificationLimits> = {},
): ArchiveVerificationReport {
  const bounded = { ...defaults, ...limits };
  const issues: ArchiveIssue[] = [];
  const records: Partial<Record<ArchiveRecordKind, readonly ArchiveRecord[]>> =
    {};
  let total = 0;
  if (archive.entries.size > bounded.maxEntries)
    issue(issues, "ARCHIVE_ENTRY_LIMIT", "Archive contains too many entries.");
  for (const [path, bytes] of archive.entries) {
    try {
      assertSafeArchivePath(path);
    } catch {
      issue(issues, "ARCHIVE_PATH_UNSAFE", "Archive path is unsafe.", path);
    }
    total += bytes.byteLength;
    if (bytes.byteLength > bounded.maxEntryBytes)
      issue(
        issues,
        "ARCHIVE_ENTRY_TOO_LARGE",
        "Archive entry exceeds its size limit.",
        path,
      );
  }
  if (total > bounded.maxTotalBytes)
    issue(
      issues,
      "ARCHIVE_TOTAL_TOO_LARGE",
      "Archive exceeds its total size limit.",
    );

  const checksums = readChecksums(archive.entries, issues);
  for (const [path, expected] of checksums) {
    const bytes = archive.entries.get(path);
    if (!bytes)
      issue(
        issues,
        "ARCHIVE_ENTRY_MISSING",
        "Checksummed entry is missing.",
        path,
      );
    else if (sha256(bytes) !== expected)
      issue(
        issues,
        "ARCHIVE_CHECKSUM_INVALID",
        "Entry checksum does not match.",
        path,
      );
  }
  for (const path of archive.entries.keys()) {
    if (path === "checksums/sha256sums.txt" || path.startsWith("signatures/"))
      continue;
    if (!checksums.has(path))
      issue(
        issues,
        "ARCHIVE_ENTRY_UNCHECKED",
        "Archive entry is not checksummed.",
        path,
      );
  }

  const manifest = readManifest(archive.entries, issues);
  for (const kind of archiveRecordKinds) {
    const path = `records/${kind}.jsonl`,
      bytes = archive.entries.get(path);
    if (!bytes) {
      if ((manifest?.recordCounts[kind] ?? 0) !== 0)
        issue(
          issues,
          "ARCHIVE_RECORD_FILE_MISSING",
          "Record file is missing.",
          path,
        );
      continue;
    }
    try {
      const parsed = decoder
        .decode(bytes)
        .trimEnd()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as ArchiveRecord);
      records[kind] = parsed;
      if (manifest && parsed.length !== manifest.recordCounts[kind])
        issue(
          issues,
          "ARCHIVE_RECORD_COUNT_INVALID",
          "Record count does not match manifest.",
          path,
        );
    } catch {
      issue(
        issues,
        "ARCHIVE_RECORD_INVALID",
        "Record JSONL is invalid UTF-8 or JSON.",
        path,
      );
    }
  }
  validateScopeAndReferences(manifest, records, issues);
  validateAuditLineage(manifest, records["audit-events"] ?? [], issues);
  validateBlobs(manifest, records.blobs ?? [], archive.entries, issues);
  return {
    valid: issues.length === 0,
    checkedEntries: checksums.size,
    issues,
    ...(manifest ? { manifest } : {}),
    records,
  };
}

function validateAuditLineage(
  manifest: TrustArchiveManifest | undefined,
  events: readonly ArchiveRecord[],
  issues: ArchiveIssue[],
) {
  if (!manifest) return;
  const lineage = manifest.auditLineage;
  if (lineage.eventCount !== events.length)
    issue(
      issues,
      "ARCHIVE_AUDIT_LINEAGE_INVALID",
      "Audit lineage count does not match exported audit records.",
    );
  const hashes = new Set(
    events
      .map((event) => event.eventHash)
      .filter((value): value is string => typeof value === "string"),
  );
  for (const boundary of [lineage.firstEventHash, lineage.lastEventHash])
    if (
      boundary !== null &&
      (!/^[a-f0-9]{64}$/.test(boundary) || !hashes.has(boundary))
    )
      issue(
        issues,
        "ARCHIVE_AUDIT_LINEAGE_INVALID",
        "Audit lineage boundary hash is not present in exported audit records.",
      );
}

function readChecksums(
  entries: ReadonlyMap<string, Uint8Array>,
  issues: ArchiveIssue[],
): Map<string, string> {
  const bytes = entries.get("checksums/sha256sums.txt"),
    result = new Map<string, string>();
  if (!bytes) {
    issue(issues, "ARCHIVE_CHECKSUM_FILE_MISSING", "Checksum file is missing.");
    return result;
  }
  try {
    for (const line of decoder.decode(bytes).trimEnd().split("\n")) {
      const match = line.match(/^([a-f0-9]{64})  (.+)$/);
      if (!match?.[1] || !match[2]) {
        issue(
          issues,
          "ARCHIVE_CHECKSUM_FILE_INVALID",
          "Checksum line is invalid.",
        );
        continue;
      }
      try {
        assertSafeArchivePath(match[2]);
      } catch {
        issue(
          issues,
          "ARCHIVE_PATH_UNSAFE",
          "Checksummed path is unsafe.",
          match[2],
        );
        continue;
      }
      if (result.has(match[2]))
        issue(
          issues,
          "ARCHIVE_CHECKSUM_DUPLICATE",
          "Checksum path is duplicated.",
          match[2],
        );
      result.set(match[2], match[1]);
    }
  } catch {
    issue(
      issues,
      "ARCHIVE_CHECKSUM_FILE_INVALID",
      "Checksum file is invalid UTF-8.",
    );
  }
  return result;
}

function readManifest(
  entries: ReadonlyMap<string, Uint8Array>,
  issues: ArchiveIssue[],
): TrustArchiveManifest | undefined {
  const bytes = entries.get("manifest.json");
  if (!bytes) {
    issue(issues, "ARCHIVE_MANIFEST_MISSING", "Manifest is missing.");
    return undefined;
  }
  try {
    const value = JSON.parse(decoder.decode(bytes)) as TrustArchiveManifest;
    if (
      value.format !== "trustarchive" ||
      value.formatVersion !== "0.2" ||
      value.checksumAlgorithm !== "sha256"
    )
      throw new Error();
    if (
      value.auditLineage?.mode !== "source_chain" ||
      value.auditLineage.sourceWorkspaceId !== value.workspaceId ||
      !Number.isSafeInteger(value.auditLineage.eventCount) ||
      value.auditLineage.eventCount < 0
    )
      throw new Error();
    return value;
  } catch {
    issue(
      issues,
      "ARCHIVE_MANIFEST_INVALID",
      "Manifest is invalid or incompatible.",
    );
    return undefined;
  }
}

function validateScopeAndReferences(
  manifest: TrustArchiveManifest | undefined,
  records: Partial<Record<ArchiveRecordKind, readonly ArchiveRecord[]>>,
  issues: ArchiveIssue[],
) {
  if (!manifest) return;
  const resources = new Set(
    (records.resources ?? [])
      .map((record) => record.id)
      .filter((id): id is string => typeof id === "string"),
  );
  const revisions = new Set(
    (records.revisions ?? [])
      .map((record) => record.id)
      .filter((id): id is string => typeof id === "string"),
  );
  for (const [kind, values] of Object.entries(records))
    for (const record of values ?? []) {
      if (
        "workspaceId" in record &&
        record.workspaceId !== manifest.workspaceId
      )
        issue(
          issues,
          "ARCHIVE_WORKSPACE_MISMATCH",
          `${kind} record crosses workspace boundary.`,
        );
    }
  for (const revision of records.revisions ?? []) {
    if (
      typeof revision.resourceId !== "string" ||
      !resources.has(revision.resourceId)
    )
      issue(
        issues,
        "ARCHIVE_REFERENCE_INVALID",
        "Revision resource does not exist.",
      );
    if (
      typeof revision.parentRevisionId === "string" &&
      !revisions.has(revision.parentRevisionId)
    )
      issue(
        issues,
        "ARCHIVE_REFERENCE_INVALID",
        "Revision parent does not exist.",
      );
  }
}

function validateBlobs(
  manifest: TrustArchiveManifest | undefined,
  blobRecords: readonly ArchiveRecord[],
  entries: ReadonlyMap<string, Uint8Array>,
  issues: ArchiveIssue[],
) {
  let total = 0;
  for (const record of blobRecords) {
    if (
      typeof record.sha256 !== "string" ||
      typeof record.byteLength !== "number"
    ) {
      issue(issues, "ARCHIVE_BLOB_RECORD_INVALID", "Blob record is invalid.");
      continue;
    }
    try {
      const path = blobArchivePath(record.sha256),
        bytes = entries.get(path);
      if (!bytes) {
        issue(issues, "ARCHIVE_BLOB_MISSING", "Blob bytes are missing.", path);
        continue;
      }
      total += bytes.byteLength;
      if (
        bytes.byteLength !== record.byteLength ||
        sha256(bytes) !== record.sha256
      )
        issue(
          issues,
          "ARCHIVE_BLOB_INVALID",
          "Blob bytes do not match metadata.",
          path,
        );
    } catch {
      issue(issues, "ARCHIVE_BLOB_RECORD_INVALID", "Blob digest is invalid.");
    }
  }
  if (
    manifest &&
    (manifest.blobCount !== blobRecords.length ||
      manifest.totalBlobBytes !== total)
  )
    issue(
      issues,
      "ARCHIVE_BLOB_COUNT_INVALID",
      "Blob totals do not match manifest.",
    );
}

function issue(
  issues: ArchiveIssue[],
  code: string,
  message: string,
  path?: string,
) {
  issues.push({ code, message, ...(path ? { path } : {}) });
}
