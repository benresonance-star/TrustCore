import { describe, expect, it } from "vitest";
import {
  evaluateRecoveryGate,
  recoveryExerciseKinds,
  type RecoveryGateEvidence,
} from "../src/index.js";

const commit = "a".repeat(40);
const at = "2026-08-05T10:00:00.000Z";

function completeEvidence(): RecoveryGateEvidence {
  return {
    sourceCommit: commit,
    generatedAt: at,
    deploymentProfile: "production-recovery",
    exercises: recoveryExerciseKinds.map((kind) => ({
      kind,
      status: "passed" as const,
      startedAt: at,
      finishedAt: "2026-08-05T10:05:00.000Z",
      environmentId: `recovery-${kind}`,
      evidenceUri: `artifact:recovery/${kind}.json`,
      ...(kind === "primary_account_unavailable"
        ? {
            primaryAccountUnavailable: true,
            independentlyAdministeredTarget: true,
          }
        : {}),
    })),
  };
}

describe("Release 0.3 recovery gate", () => {
  it("passes only complete, exact-commit recovery evidence", () => {
    const report = evaluateRecoveryGate(completeEvidence());
    expect(report.status).toBe("pass");
    expect(report.checkedExercises).toBe(6);
    expect(report.issues).toEqual([]);
  });

  it("rejects missing, failed and unrun exercises", () => {
    const evidence = completeEvidence();
    const report = evaluateRecoveryGate({
      ...evidence,
      exercises: evidence.exercises
        .filter((item) => item.kind !== "key_recovery")
        .map((item) =>
          item.kind === "postgres_pitr"
            ? { ...item, status: "failed" as const }
            : item.kind === "missing_blob_restore"
              ? { ...item, status: "not_run" as const }
              : item,
        ),
    });
    expect(report.status).toBe("fail");
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "RECOVERY_EXERCISE_FAILED",
        "RECOVERY_EXERCISE_NOT_RUN",
        "RECOVERY_EXERCISE_MISSING",
      ]),
    );
  });

  it("requires a genuine independently administered outage drill", () => {
    const evidence = completeEvidence();
    const report = evaluateRecoveryGate({
      ...evidence,
      exercises: evidence.exercises.map((item) =>
        item.kind === "primary_account_unavailable"
          ? {
              ...item,
              primaryAccountUnavailable: false,
              independentlyAdministeredTarget: false,
            }
          : item,
      ),
    });
    expect(report.status).toBe("fail");
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "RECOVERY_OUTAGE_BOUNDARY_UNPROVEN",
      }),
    );
  });
});
