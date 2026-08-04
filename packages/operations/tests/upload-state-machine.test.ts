import { describe, expect, it } from "vitest";
import { InvalidOperationTransition, transitionUpload } from "../src/index.js";
import type { UploadState } from "../src/index.js";

describe("upload operation", () => {
  it("follows the canonical happy path", () => {
    const path = ["authorised", "temporary_upload_created", "bytes_received", "hash_verified", "immutable_object_committed", "metadata_committed", "audit_committed", "completed"] as const;
    let state: UploadState = "requested";
    for (const next of path) state = transitionUpload(state, next);
    expect(state).toBe("completed");
  });

  it("does not allow completed operations to mutate", () => {
    expect(() => transitionUpload("completed", "authorised")).toThrow(InvalidOperationTransition);
  });
});
