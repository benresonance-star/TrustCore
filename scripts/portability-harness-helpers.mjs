import { randomUUID } from "node:crypto";

const safeRunId = /^[a-z0-9]{8,40}$/;

export function createRunScope(value = randomUUID().replaceAll("-", "")) {
  const runId = value.toLowerCase();
  if (!safeRunId.test(runId)) throw new Error("Portability run ID is unsafe.");
  return Object.freeze({
    runId,
    sourceDatabase: `trust_port_src_${runId}`,
    targetDatabase: `trust_port_dst_${runId}`,
    sourceBucket: `trust-port-src-${runId}`,
    targetBucket: `trust-port-dst-${runId}`,
  });
}

export function quotePostgresIdentifier(value) {
  if (!/^trust_port_(?:src|dst)_[a-z0-9]{8,40}$/.test(value))
    throw new Error("Refusing an unscoped PostgreSQL identifier.");
  return `"${value}"`;
}

export function assertScopedBucket(value, runId) {
  if (
    value !== `trust-port-src-${runId}` &&
    value !== `trust-port-dst-${runId}`
  )
    throw new Error("Refusing an unscoped MinIO bucket.");
  return value;
}

export function safeFailureDetail(error) {
  const code =
    error && typeof error === "object" && "exitCode" in error
      ? error.exitCode
      : null;
  return code === null || code === undefined
    ? "Stage could not be started or completed; inspect the console output."
    : `Command exited with code ${code}.`;
}

export function markdownReport(report) {
  const lines = [
    "# Trust Core release 0.2 portability gate",
    "",
    `- Status: **${report.status.toUpperCase()}**`,
    `- Initial clean committed HEAD: **${report.initial.clean ? "YES" : "NO"}**`,
    `- Final identical clean HEAD: **${report.final.identicalCleanHead ? "YES" : "NO"}**`,
    `- Commit: ${report.initial.gitSha}`,
    `- Started: ${report.startedAt}`,
    `- Finished: ${report.finishedAt}`,
    `- Duration: ${report.durationMs} ms`,
    `- Platform: ${report.environment.platform}`,
    `- Node: ${report.environment.node}`,
    `- Docker: ${report.environment.docker ?? "unavailable"}`,
    "",
    "## Stages",
    "",
  ];
  for (const stage of report.stages) {
    lines.push(
      `- ${stage.name}: ${stage.status.toUpperCase()} (${stage.durationMs} ms)`,
    );
    if (stage.detail) lines.push(`  - ${stage.detail}`);
  }
  if (report.evidence) {
    lines.push("", "## Fixture evidence", "");
    for (const fixture of report.evidence.fixtures) {
      lines.push(`### ${fixture.name}`, "");
      for (const checkpoint of fixture.checkpointRestarts)
        lines.push(`- Restart after ${checkpoint}: PASS`);
      for (const [name, passed] of Object.entries(fixture.proofs))
        lines.push(`- ${name}: ${passed ? "PASS" : "FAIL"}`);
      lines.push("");
    }
    lines.push("## Negative archive cases", "");
    for (const name of report.evidence.negativeCases)
      lines.push(`- ${name}: PASS`);
    lines.push("");
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}
