import { describe, expect, it } from "vitest";
import {
  assertScopedBucket,
  createRunScope,
  markdownReport,
  quotePostgresIdentifier,
  safeFailureDetail,
} from "./portability-harness-helpers.mjs";

describe("portability Docker harness helpers", () => {
  it("derives isolated resources from a safe run ID", () => {
    const scope = createRunScope("abc12345");
    expect(scope).toEqual({
      runId: "abc12345",
      sourceDatabase: "trust_port_src_abc12345",
      targetDatabase: "trust_port_dst_abc12345",
      sourceBucket: "trust-port-src-abc12345",
      targetBucket: "trust-port-dst-abc12345",
    });
    expect(quotePostgresIdentifier(scope.sourceDatabase)).toBe(
      '"trust_port_src_abc12345"',
    );
    expect(assertScopedBucket(scope.targetBucket, scope.runId)).toBe(
      scope.targetBucket,
    );
  });

  it("fails closed for unrelated resources", () => {
    expect(() => createRunScope("../shared")).toThrow("unsafe");
    expect(() => quotePostgresIdentifier("trust_core")).toThrow("unscoped");
    expect(() => assertScopedBucket("trust-core-local", "abc12345")).toThrow(
      "unscoped",
    );
  });

  it("produces sanitized report text", () => {
    const report = markdownReport({
      status: "fail",
      clean: false,
      gitSha: "a".repeat(40),
      startedAt: "2026-08-05T00:00:00.000Z",
      finishedAt: "2026-08-05T00:00:01.000Z",
      durationMs: 1000,
      environment: { platform: "test x64", node: "v24", docker: null },
      stages: [
        {
          name: "example",
          status: "fail",
          durationMs: 1,
          detail: safeFailureDetail({ exitCode: 7, secret: "hidden" }),
        },
      ],
    });
    expect(report).toContain("Command exited with code 7.");
    expect(report).not.toContain("hidden");
  });
});
