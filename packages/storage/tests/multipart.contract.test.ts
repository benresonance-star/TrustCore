import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { MemoryObjectStorage } from "../src/memory-object-storage.js";
import { MULTIPART_PROVIDER_LIMITS } from "../src/types.js";

describe("MemoryObjectStorage internal multipart", () => {
  it("initiates idempotently and completes with checksum verification", async () => {
    const storage = new MemoryObjectStorage({ relaxMultipartLimits: true });
    const locator = {
      key: "workspaces/workspace_1/temporary/multipart_1",
    };
    const body = Buffer.from("hello-multipart-world");
    const sha256 = createHash("sha256").update(body).digest("hex");
    const first = await storage.initiateMultipartUpload({
      uploadId: "upload_1",
      locator,
      mediaType: "text/plain",
      partSize: 8,
      expectedByteLength: body.byteLength,
      expectedSha256: sha256,
    });
    const second = await storage.initiateMultipartUpload({
      uploadId: "upload_1",
      locator,
      mediaType: "text/plain",
      partSize: 8,
    });
    expect(second.providerUploadRef).toBe(first.providerUploadRef);

    const part1 = await storage.uploadMultipartPart({
      uploadId: "upload_1",
      locator,
      providerUploadRef: first.providerUploadRef,
      partNumber: 1,
      body: Readable.from(body.subarray(0, 8)),
      size: 8,
    });
    const part2 = await storage.uploadMultipartPart({
      uploadId: "upload_1",
      locator,
      providerUploadRef: first.providerUploadRef,
      partNumber: 2,
      body: Readable.from(body.subarray(8)),
      size: body.byteLength - 8,
    });
    const listed = await storage.listMultipartParts({
      uploadId: "upload_1",
      locator,
      providerUploadRef: first.providerUploadRef,
    });
    expect(listed).toEqual([part1, part2]);

    const completed = await storage.completeMultipartUpload({
      uploadId: "upload_1",
      locator,
      providerUploadRef: first.providerUploadRef,
      parts: [part1, part2],
      expectedByteLength: body.byteLength,
      expectedSha256: sha256,
    });
    expect(completed.sha256).toBe(sha256);
    expect(await readAll(await storage.openReadStream(locator))).toEqual(body);
  });

  it("rejects inconsistent duplicate parts and refuses complete after abort", async () => {
    const storage = new MemoryObjectStorage({ relaxMultipartLimits: true });
    const locator = { key: "workspaces/workspace_1/temporary/multipart_2" };
    const session = await storage.initiateMultipartUpload({
      uploadId: "upload_2",
      locator,
      mediaType: "text/plain",
      partSize: 4,
    });
    await storage.uploadMultipartPart({
      uploadId: "upload_2",
      locator,
      providerUploadRef: session.providerUploadRef,
      partNumber: 1,
      body: Readable.from(Buffer.from("abcd")),
      size: 4,
    });
    await expect(
      storage.uploadMultipartPart({
        uploadId: "upload_2",
        locator,
        providerUploadRef: session.providerUploadRef,
        partNumber: 1,
        body: Readable.from(Buffer.from("zzzz")),
        size: 4,
      }),
    ).rejects.toThrow(/inconsistent/);
    await storage.abortMultipartUpload({
      uploadId: "upload_2",
      locator,
      providerUploadRef: session.providerUploadRef,
    });
    await storage.abortMultipartUpload({
      uploadId: "upload_2",
      locator,
      providerUploadRef: session.providerUploadRef,
    });
    await expect(
      storage.completeMultipartUpload({
        uploadId: "upload_2",
        locator,
        providerUploadRef: session.providerUploadRef,
        parts: [],
        expectedByteLength: 4,
        expectedSha256: "0".repeat(64),
      }),
    ).rejects.toThrow(/aborted/);
  });

  it("rejects part sizes outside provider limits when not relaxed", async () => {
    const storage = new MemoryObjectStorage();
    await expect(
      storage.initiateMultipartUpload({
        uploadId: "upload_3",
        locator: { key: "workspaces/workspace_1/temporary/multipart_3" },
        mediaType: "text/plain",
        partSize: MULTIPART_PROVIDER_LIMITS.minPartSize - 1,
      }),
    ).rejects.toThrow(/part size/);
  });

  it("recombines seeded random ranges into the original object", async () => {
    const storage = new MemoryObjectStorage({ relaxMultipartLimits: true });
    const seed = 0x5eed;
    const body = seededBytes(seed, 64);
    const locator = {
      key: "workspaces/workspace_1/temporary/multipart_range",
    };
    await storage.writeTemporary({
      locator,
      body: Readable.from(body),
      mediaType: "application/octet-stream",
    });
    const ranges = [
      { start: 0, end: 15 },
      { start: 16, end: 31 },
      { start: 32, end: 47 },
      { start: 48, end: 63 },
    ];
    const chunks: Buffer[] = [];
    for (const range of ranges) {
      chunks.push(await readAll(await storage.openReadStream({ ...locator, range })));
    }
    expect(Buffer.concat(chunks)).toEqual(body);
    await expect(
      storage.openReadStream({ ...locator, range: { start: 10, end: 9 } }),
    ).rejects.toThrow(/range/i);
  });
});

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function seededBytes(seed: number, length: number): Buffer {
  const out = Buffer.alloc(length);
  let state = seed >>> 0;
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[index] = state & 0xff;
  }
  return out;
}
