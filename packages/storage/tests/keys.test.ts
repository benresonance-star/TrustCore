import { describe, expect, it } from "vitest";
import { canonicalObjectKey } from "../src/index.js";

describe("canonical storage keys", () => {
  it("contains no user-facing title", () => {
    const hash = "ab" + "0".repeat(62);
    expect(canonicalObjectKey("workspace_1", hash)).toBe(`workspaces/workspace_1/objects/ab/${hash}`);
  });
  it("rejects unsafe workspace IDs", () => expect(() => canonicalObjectKey("../other", "0".repeat(64))).toThrow());
});
