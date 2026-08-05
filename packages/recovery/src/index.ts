export const recoveryExerciseKinds = [
  "postgres_pitr",
  "missing_blob_restore",
  "combined_store_restore",
  "key_recovery",
  "primary_account_unavailable",
  "full_trust_verification",
] as const;

export type RecoveryExerciseKind = (typeof recoveryExerciseKinds)[number];
export type RecoveryExerciseStatus = "passed" | "failed" | "not_run";

export interface RecoveryExerciseEvidence {
  readonly kind: RecoveryExerciseKind;
  readonly status: RecoveryExerciseStatus;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly environmentId: string;
  readonly evidenceUri: string;
  readonly notes?: string;
  readonly primaryAccountUnavailable?: boolean;
  readonly independentlyAdministeredTarget?: boolean;
}

export interface RecoveryGateEvidence {
  readonly sourceCommit: string;
  readonly generatedAt: string;
  readonly deploymentProfile: string;
  readonly exercises: readonly RecoveryExerciseEvidence[];
}

export interface RecoveryGateIssue {
  readonly code: string;
  readonly exercise?: RecoveryExerciseKind;
  readonly message: string;
}

export interface RecoveryGateReport {
  readonly status: "pass" | "fail";
  readonly sourceCommit: string;
  readonly checkedExercises: number;
  readonly issues: readonly RecoveryGateIssue[];
}

export function evaluateRecoveryGate(
  evidence: RecoveryGateEvidence,
): RecoveryGateReport {
  const issues: RecoveryGateIssue[] = [];
  if (!/^[a-f0-9]{40}$/.test(evidence.sourceCommit)) {
    issues.push({
      code: "RECOVERY_SOURCE_COMMIT_INVALID",
      message: "Recovery evidence must identify an exact Git commit.",
    });
  }
  if (!isIsoTimestamp(evidence.generatedAt)) {
    issues.push({
      code: "RECOVERY_GENERATED_AT_INVALID",
      message: "Recovery evidence requires a valid generated timestamp.",
    });
  }
  if (evidence.deploymentProfile.trim().length === 0) {
    issues.push({
      code: "RECOVERY_DEPLOYMENT_PROFILE_REQUIRED",
      message: "Recovery evidence must identify its deployment profile.",
    });
  }

  const byKind = new Map<RecoveryExerciseKind, RecoveryExerciseEvidence>();
  for (const exercise of evidence.exercises) {
    if (byKind.has(exercise.kind)) {
      issues.push({
        code: "RECOVERY_EXERCISE_DUPLICATE",
        exercise: exercise.kind,
        message: "Recovery evidence contains a duplicate exercise.",
      });
      continue;
    }
    byKind.set(exercise.kind, exercise);
    validateExercise(exercise, issues);
  }
  for (const kind of recoveryExerciseKinds) {
    if (!byKind.has(kind)) {
      issues.push({
        code: "RECOVERY_EXERCISE_MISSING",
        exercise: kind,
        message: "A required recovery exercise has no evidence.",
      });
    }
  }

  const outage = byKind.get("primary_account_unavailable");
  if (
    outage?.status === "passed" &&
    (outage.primaryAccountUnavailable !== true ||
      outage.independentlyAdministeredTarget !== true)
  ) {
    issues.push({
      code: "RECOVERY_OUTAGE_BOUNDARY_UNPROVEN",
      exercise: "primary_account_unavailable",
      message:
        "The outage drill must prove the primary account was unavailable and the target was independently administered.",
    });
  }

  return {
    status: issues.length === 0 ? "pass" : "fail",
    sourceCommit: evidence.sourceCommit,
    checkedExercises: byKind.size,
    issues,
  };
}

function validateExercise(
  exercise: RecoveryExerciseEvidence,
  issues: RecoveryGateIssue[],
): void {
  switch (exercise.status) {
    case "passed":
      break;
    case "failed":
      issues.push({
        code: "RECOVERY_EXERCISE_FAILED",
        exercise: exercise.kind,
        message: "A required recovery exercise failed.",
      });
      break;
    case "not_run":
      issues.push({
        code: "RECOVERY_EXERCISE_NOT_RUN",
        exercise: exercise.kind,
        message: "A required recovery exercise was not run.",
      });
      break;
    default: {
      const unreachable: never = exercise.status;
      throw new Error(`Unknown recovery status: ${String(unreachable)}`);
    }
  }
  if (
    !isIsoTimestamp(exercise.startedAt) ||
    !isIsoTimestamp(exercise.finishedAt) ||
    Date.parse(exercise.finishedAt) < Date.parse(exercise.startedAt)
  ) {
    issues.push({
      code: "RECOVERY_EXERCISE_TIME_INVALID",
      exercise: exercise.kind,
      message: "Recovery exercise timestamps are invalid or out of order.",
    });
  }
  if (exercise.environmentId.trim().length === 0) {
    issues.push({
      code: "RECOVERY_ENVIRONMENT_REQUIRED",
      exercise: exercise.kind,
      message: "Recovery exercise evidence must identify its environment.",
    });
  }
  if (!isEvidenceUri(exercise.evidenceUri)) {
    issues.push({
      code: "RECOVERY_EVIDENCE_URI_INVALID",
      exercise: exercise.kind,
      message: "Recovery exercise evidence must use an HTTPS or artifact URI.",
    });
  }
}

function isIsoTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && value.includes("T");
}

function isEvidenceUri(value: string): boolean {
  return /^(https:\/\/|artifact:)[^\s]+$/.test(value);
}
