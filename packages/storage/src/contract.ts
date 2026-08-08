import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { canonicalObjectKey } from "./keys.js";
import type { ObjectStorage } from "./types.js";

export interface ObjectStorageContractHarness {
  readonly storage: ObjectStorage;
  readonly workspaceId: string;
  /** Optional: assert provider errors for denied/outage when live infra supports it. */
  readonly probeDeniedExists?: () => Promise<void>;
  readonly probeOutageExists?: () => Promise<void>;
}

/**
 * Provider-neutral ObjectStorage behaviours shared by memory, MinIO, and S3 adapters.
 * Call from package test files; do not weaken assertions to accommodate a weak adapter.
 */
export async function assertObjectStorageContract(
  harness: ObjectStorageContractHarness,
): Promise<void> {
  const { storage, workspaceId } = harness;

  await assertStreamedTemporaryRoundTrip(storage, workspaceId);
  await assertImmutableCommitHeadAndRead(storage, workspaceId);
  await assertDeduplicateEqualBytes(storage, workspaceId);
  await assertRejectDifferingBytes(storage, workspaceId);
  await assertStreamingLargeBody(storage, workspaceId);
  await assertZeroByteObject(storage, workspaceId);

  if (harness.probeDeniedExists) await harness.probeDeniedExists();
  if (harness.probeOutageExists) await harness.probeOutageExists();
}

async function assertStreamedTemporaryRoundTrip(
  storage: ObjectStorage,
  workspaceId: string,
): Promise<void> {
  const body = Buffer.from("streamed-in-three-chunks");
  const temporary = await storage.createTemporaryUpload({
    workspaceId,
    operationId: "streamed_write",
  });
  const metadata = await storage.writeTemporary({
    locator: temporary,
    body: Readable.from([
      body.subarray(0, 4),
      body.subarray(4, 11),
      body.subarray(11),
    ]),
    mediaType: "text/plain",
  });
  expectEqual(metadata, {
    key: temporary.key,
    byteLength: body.byteLength,
    mediaType: "text/plain",
    sha256: sha256(body),
  });
  expectTrue(await storage.exists(temporary));
  await storage.deleteTemporary(temporary);
  expectTrue(!(await storage.exists(temporary)));
}

async function assertImmutableCommitHeadAndRead(
  storage: ObjectStorage,
  workspaceId: string,
): Promise<void> {
  const body = Buffer.from("immutable-object");
  const digest = sha256(body);
  const temporary = await upload(storage, workspaceId, "immutable_commit", body, "text/plain");
  const committed = await storage.commitImmutable({
    temporary,
    workspaceId,
    sha256: digest,
    byteLength: body.byteLength,
    mediaType: "text/plain",
  });
  expectEqual(committed.key, canonicalObjectKey(workspaceId, digest));
  expectEqual(committed.sha256, digest);
  const head = await storage.head(committed);
  expectEqual(head.key, committed.key);
  expectEqual(head.byteLength, body.byteLength);
  expectEqual(head.mediaType, "text/plain");
  expectEqual(head.sha256, digest);
  expectEqual(await readAll(await storage.openReadStream(committed)), body);
  expectTrue(!(await storage.exists(temporary)));
  expectTrue(!(await storage.exists({ key: `${temporary.key}_missing` })));
  await expectRejects(storage.head({ key: `${temporary.key}_missing` }));
}

async function assertDeduplicateEqualBytes(
  storage: ObjectStorage,
  workspaceId: string,
): Promise<void> {
  const body = Buffer.from("deduplicated-object");
  const digest = sha256(body);
  const first = await upload(storage, workspaceId, "dedupe_first", body, "text/plain");
  const initial = await storage.commitImmutable({
    temporary: first,
    workspaceId,
    sha256: digest,
    byteLength: body.byteLength,
    mediaType: "text/plain",
  });
  const duplicate = await upload(
    storage,
    workspaceId,
    "dedupe_second",
    body,
    "application/octet-stream",
  );
  const deduplicated = await storage.commitImmutable({
    temporary: duplicate,
    workspaceId,
    sha256: digest,
    byteLength: body.byteLength,
    mediaType: "application/octet-stream",
  });
  expectEqual(deduplicated.key, initial.key);
  expectEqual(deduplicated.mediaType, "text/plain");
  expectTrue(!(await storage.exists(duplicate)));
  const retried = await storage.commitImmutable({
    temporary: duplicate,
    workspaceId,
    sha256: digest,
    byteLength: body.byteLength,
    mediaType: "application/octet-stream",
  });
  expectEqual(retried.key, initial.key);
  expectEqual(retried.sha256, digest);
}

async function assertRejectDifferingBytes(
  storage: ObjectStorage,
  workspaceId: string,
): Promise<void> {
  const canonicalBody = Buffer.from("canonical-bytes");
  const differentBody = Buffer.from("different-bytes");
  expectEqual(differentBody.byteLength, canonicalBody.byteLength);
  const digest = sha256(canonicalBody);
  const first = await upload(
    storage,
    workspaceId,
    "conflict_first",
    canonicalBody,
    "text/plain",
  );
  const committed = await storage.commitImmutable({
    temporary: first,
    workspaceId,
    sha256: digest,
    byteLength: canonicalBody.byteLength,
    mediaType: "text/plain",
  });
  const conflicting = await upload(
    storage,
    workspaceId,
    "conflict_second",
    differentBody,
    "text/plain",
  );
  await expectRejects(
    storage.commitImmutable({
      temporary: conflicting,
      workspaceId,
      sha256: digest,
      byteLength: differentBody.byteLength,
      mediaType: "text/plain",
    }),
  );
  expectEqual(await readAll(await storage.openReadStream(committed)), canonicalBody);
  expectTrue(await storage.exists(conflicting));
  await storage.deleteTemporary(conflicting);
}

async function assertStreamingLargeBody(
  storage: ObjectStorage,
  workspaceId: string,
): Promise<void> {
  const body = Buffer.alloc(256 * 1024, 7);
  const temporary = await upload(
    storage,
    workspaceId,
    "large_stream",
    body,
    "application/octet-stream",
  );
  const digest = sha256(body);
  const committed = await storage.commitImmutable({
    temporary,
    workspaceId,
    sha256: digest,
    byteLength: body.byteLength,
    mediaType: "application/octet-stream",
  });
  expectEqual(await readAll(await storage.openReadStream(committed)), body);
}

async function assertZeroByteObject(
  storage: ObjectStorage,
  workspaceId: string,
): Promise<void> {
  const body = Buffer.alloc(0);
  const temporary = await upload(
    storage,
    workspaceId,
    "zero_byte",
    body,
    "application/octet-stream",
  );
  const digest = sha256(body);
  const committed = await storage.commitImmutable({
    temporary,
    workspaceId,
    sha256: digest,
    byteLength: 0,
    mediaType: "application/octet-stream",
  });
  expectEqual(committed.byteLength, 0);
  expectEqual(await readAll(await storage.openReadStream(committed)), body);
}

async function upload(
  storage: ObjectStorage,
  workspaceId: string,
  operationId: string,
  body: Buffer,
  mediaType: string,
): Promise<{ key: string }> {
  const temporary = await storage.createTemporaryUpload({
    workspaceId,
    operationId,
  });
  await storage.writeTemporary({
    locator: temporary,
    body: Readable.from(body),
    mediaType,
  });
  return temporary;
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function sha256(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

function expectEqual(actual: unknown, expected: unknown): void {
  if (!deepEqual(actual, expected)) {
    throw new Error(
      `Contract assertion failed:\nactual=${inspect(actual)}\nexpected=${inspect(expected)}`,
    );
  }
}

function expectTrue(value: boolean): void {
  if (!value) throw new Error("Contract assertion expected true");
}

async function expectRejects(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch {
    return;
  }
  throw new Error("Contract assertion expected rejection");
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Buffer.isBuffer(a) && Buffer.isBuffer(b)) return a.equals(b);
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (!a || !b || typeof a !== "object") return false;
  const aKeys = Object.keys(a as object).sort();
  const bKeys = Object.keys(b as object).sort();
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key, index) =>
      key === bKeys[index] &&
      deepEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      ),
  );
}

function inspect(value: unknown): string {
  if (Buffer.isBuffer(value)) return `Buffer(${value.byteLength})`;
  return JSON.stringify(value);
}
