import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
  type Entry,
} from "@zip.js/zip.js";
import { assertSafeArchivePath } from "./paths.js";
import type {
  ArchiveContainerLimits,
  ArchiveEntrySet,
  ParsedTrustArchive,
} from "./types.js";
import { verifyArchiveEntries } from "./verify.js";

const defaultLimits: ArchiveContainerLimits = {
  maxContainerBytes: 10 * 1024 * 1024 * 1024,
  maxEntries: 100_000,
  maxEntryBytes: 2 * 1024 * 1024 * 1024,
  maxTotalBytes: 20 * 1024 * 1024 * 1024,
  maxCompressionRatio: 200,
};

export class ArchiveContainerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly path?: string,
  ) {
    super(message);
    this.name = "ArchiveContainerError";
  }
}

export async function writeTrustArchive(
  archive: Pick<ArchiveEntrySet, "entries" | "manifest">,
): Promise<Uint8Array> {
  const output = new Uint8ArrayWriter();
  const writer = new ZipWriter(output, {
    zip64: true,
    level: 6,
    keepOrder: true,
  });
  const timestamp = validZipTimestamp(archive.manifest.createdAt);
  for (const [path, bytes] of [...archive.entries].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    assertSafeArchivePath(path);
    await writer.add(path, new Uint8ArrayReader(bytes), {
      lastModDate: timestamp,
      lastAccessDate: timestamp,
      creationDate: timestamp,
      zip64: true,
    });
  }
  return writer.close(undefined, { zip64: true });
}

export async function readTrustArchive(
  bytes: Uint8Array,
  limits: Partial<ArchiveContainerLimits> = {},
): Promise<ParsedTrustArchive> {
  const bounded = { ...defaultLimits, ...limits };
  if (bytes.byteLength > bounded.maxContainerBytes)
    throw new ArchiveContainerError(
      "ARCHIVE_CONTAINER_TOO_LARGE",
      "Archive container exceeds its size limit.",
    );
  const reader = new ZipReader(new Uint8ArrayReader(bytes), {
    strictness: "strict",
    checkSignature: true,
    checkOverlappingEntry: true,
  });
  try {
    const entries = await reader.getEntries({ strictness: "strict" });
    validateDirectory(entries, bounded);
    const extracted = new Map<string, Uint8Array>();
    for (const entry of entries) {
      if (entry.directory) continue;
      const data = await entry.getData(new Uint8ArrayWriter(), {
        strictness: "strict",
        checkSignature: true,
        checkOverlappingEntry: true,
      });
      if (data.byteLength !== entry.uncompressedSize)
        throw new ArchiveContainerError(
          "ARCHIVE_ENTRY_SIZE_INVALID",
          "Extracted entry size does not match its directory metadata.",
          entry.filename,
        );
      extracted.set(entry.filename, data);
    }
    const verification = verifyArchiveEntries(
      { entries: extracted },
      {
        maxEntries: bounded.maxEntries,
        maxEntryBytes: bounded.maxEntryBytes,
        maxTotalBytes: bounded.maxTotalBytes,
      },
    );
    const manifest = verification.manifest;
    if (!manifest)
      throw new ArchiveContainerError(
        "ARCHIVE_MANIFEST_INVALID",
        "Archive manifest could not be verified.",
      );
    return { entries: extracted, manifest, verification };
  } catch (error) {
    if (error instanceof ArchiveContainerError) throw error;
    throw new ArchiveContainerError(
      "ARCHIVE_CONTAINER_INVALID",
      "Archive container is corrupt, ambiguous or unsupported.",
    );
  } finally {
    await reader.close().catch(() => undefined);
  }
}

function validateDirectory(
  entries: readonly Entry[],
  limits: ArchiveContainerLimits,
): void {
  if (entries.length > limits.maxEntries)
    throw new ArchiveContainerError(
      "ARCHIVE_ENTRY_LIMIT",
      "Archive contains too many entries.",
    );
  const paths = new Set<string>();
  let total = 0;
  for (const entry of entries) {
    if (entry.directory)
      throw new ArchiveContainerError(
        "ARCHIVE_DIRECTORY_ENTRY_DENIED",
        "Explicit directory entries are not permitted.",
        entry.filename,
      );
    try {
      assertSafeArchivePath(entry.filename);
    } catch {
      throw new ArchiveContainerError(
        "ARCHIVE_PATH_UNSAFE",
        "Archive path is unsafe.",
        entry.filename,
      );
    }
    if (paths.has(entry.filename))
      throw new ArchiveContainerError(
        "ARCHIVE_PATH_DUPLICATE",
        "Archive path is duplicated.",
        entry.filename,
      );
    paths.add(entry.filename);
    if (entry.encrypted)
      throw new ArchiveContainerError(
        "ARCHIVE_ENCRYPTION_UNSUPPORTED",
        "Encrypted archive entries are not supported.",
        entry.filename,
      );
    if (isSymbolicLink(entry))
      throw new ArchiveContainerError(
        "ARCHIVE_LINK_DENIED",
        "Symbolic links are not permitted in Trust Archives.",
        entry.filename,
      );
    if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8)
      throw new ArchiveContainerError(
        "ARCHIVE_COMPRESSION_UNSUPPORTED",
        "Archive compression method is not supported.",
        entry.filename,
      );
    if (entry.uncompressedSize > limits.maxEntryBytes)
      throw new ArchiveContainerError(
        "ARCHIVE_ENTRY_TOO_LARGE",
        "Archive entry exceeds its size limit.",
        entry.filename,
      );
    total += entry.uncompressedSize;
    if (total > limits.maxTotalBytes)
      throw new ArchiveContainerError(
        "ARCHIVE_TOTAL_TOO_LARGE",
        "Archive exceeds its total uncompressed size limit.",
      );
    const ratio =
      entry.uncompressedSize === 0
        ? 1
        : entry.compressedSize === 0
          ? Number.POSITIVE_INFINITY
          : entry.uncompressedSize / entry.compressedSize;
    if (ratio > limits.maxCompressionRatio)
      throw new ArchiveContainerError(
        "ARCHIVE_COMPRESSION_RATIO_EXCEEDED",
        "Archive entry exceeds the permitted compression ratio.",
        entry.filename,
      );
  }
}

function isSymbolicLink(entry: Entry): boolean {
  const mode = entry.unixMode ?? entry.unixExternalUpper;
  return mode !== undefined && (mode & 0o170000) === 0o120000;
}

function validZipTimestamp(value: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()))
    throw new Error("Archive creation time is invalid.");
  const minimum = Date.UTC(1980, 0, 1);
  return parsed.getTime() < minimum ? new Date(minimum) : parsed;
}
