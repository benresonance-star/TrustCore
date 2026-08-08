import { describe, expect, it } from "vitest";
import { appCapabilities } from "@trust-core/app-protocol";
import { labelForCapability } from "../src/capability-labels";

describe("capability labels", () => {
  it("provides plain-language labels for every capability", () => {
    for (const capability of appCapabilities) {
      const label = labelForCapability(capability);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe(capability);
    }
  });
});
