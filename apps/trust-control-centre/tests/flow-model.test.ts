import { describe, expect, it } from "vitest";
import {
  flowBadgeCounts,
  flowNodeLevel,
  flowNodes,
} from "../src/flow-model";
import { getWiringEntry } from "../src/wiring-status";

describe("flow-model", () => {
  it("defines ten topology nodes with unique ids", () => {
    expect(flowNodes).toHaveLength(10);
    const ids = flowNodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(10);
  });

  it("uses the Live / Partial / Dummy badge matrix 4 / 5 / 1 from wiring catalog", () => {
    expect(flowBadgeCounts()).toEqual({ live: 4, partial: 5, dummy: 1 });
    expect(flowNodeLevel(flowNodes.find((node) => node.id === "semantic")!)).toBe(
      "dummy",
    );
  });

  it("keeps node chrome level in sync with wiring-status entries", () => {
    for (const node of flowNodes) {
      expect(flowNodeLevel(node)).toBe(getWiringEntry(node.wiringId).level);
      expect(node.wiringId).toBe(`flow.node.${node.id}`);
      expect(node.description.trim().length).toBeGreaterThanOrEqual(80);
      expect(node.features.length).toBeGreaterThanOrEqual(1);
      expect(node.deepLink).toBeTruthy();
      expect(node.deepLinkLabel).toBeTruthy();
      expect(node.deepLinkLabel.includes("→")).toBe(false);
    }
  });
});
