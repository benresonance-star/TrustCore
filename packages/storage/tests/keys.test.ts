import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MemoryObjectStorage,
  StorageError,
  assertObjectStorageContract,
  canonicalObjectKey,
  redactSensitive,
} from "../src/index.js";

describe("canonical storage keys", () => {
  it("contains no user-facing title", () => {
    const hash = "ab" + "0".repeat(62);
    expect(canonicalObjectKey("workspace_1", hash)).toBe(
      `workspaces/workspace_1/objects/ab/${hash}`,
    );
  });
  it("rejects unsafe workspace IDs", () =>
    expect(() => canonicalObjectKey("../other", "0".repeat(64))).toThrow());
});

describe("StorageError redaction", () => {
  it("redacts urls and credential-like query material", () => {
    expect(
      redactSensitive(
        "failed https://bucket.s3.amazonaws.com/key?X-Amz-Signature=abc123&credential=AKIASECRET",
      ),
    ).toBe(
      "failed [redacted-url]",
    );
    expect(
      new StorageError(
        "access_denied",
        "denied secret=super-secret value",
      ).message,
    ).toContain("[redacted]");
  });
});

describe("MemoryObjectStorage contract", () => {
  it("passes the shared provider-neutral contract", async () => {
    const workspaceId = `memory_${randomBytes(4).toString("hex")}`;
    await assertObjectStorageContract({
      storage: new MemoryObjectStorage(),
      workspaceId,
    });
  });
});
