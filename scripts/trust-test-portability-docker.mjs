import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { platform } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  createRunScope,
  markdownReport,
  safeFailureDetail,
} from "./portability-harness-helpers.mjs";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const reportsDirectory = resolve(root, "reports");
const jsonReport = resolve(
  reportsDirectory,
  "release-0.2-portability-gate.json",
);
const markdownReportPath = resolve(
  reportsDirectory,
  "release-0.2-portability-gate.md",
);
const started = Date.now();
const startedAt = new Date(started).toISOString();
const stages = [];
const scope = createRunScope();
const pnpm = process.env.npm_execpath
  ? { file: process.execPath, prefix: [process.env.npm_execpath] }
  : { file: "corepack", prefix: ["pnpm@10.15.0"] };
const environment = {
  ...process.env,
  TRUST_DOCKER_TESTS: "1",
  TRUST_PORTABILITY_RUN_ID: scope.runId,
  POSTGRES_ADMIN_URL:
    process.env.POSTGRES_ADMIN_URL ??
    "postgresql://trust_admin:trust_admin_local_only@localhost:54329/trust_core",
  TRUST_STORAGE_ENDPOINT:
    process.env.TRUST_STORAGE_ENDPOINT ?? "http://localhost:5900",
  TRUST_STORAGE_REGION: process.env.TRUST_STORAGE_REGION ?? "us-east-1",
  TRUST_STORAGE_ACCESS_KEY: process.env.TRUST_STORAGE_ACCESS_KEY ?? "trustcore",
  TRUST_STORAGE_SECRET_KEY:
    process.env.TRUST_STORAGE_SECRET_KEY ?? "trustcore-local-secret",
};

const gitSha = await output("git", ["rev-parse", "HEAD"]);
const initialStatus = await output("git", ["status", "--porcelain"]);
const clean = initialStatus === "";
if (!clean) {
  stages.push({
    name: "clean-committed-head",
    status: "fail",
    durationMs: 0,
    detail: "Working tree was not clean before the gate started.",
  });
} else {
  stages.push({
    name: "clean-committed-head",
    status: "pass",
    durationMs: 0,
  });
}

const definitions = [
  {
    name: "compose-configuration",
    file: "docker",
    args: ["compose", "--project-name", "trust-core", "config", "--quiet"],
  },
  {
    name: "shared-service-readiness",
    file: "docker",
    args: [
      "compose",
      "--project-name",
      "trust-core",
      "up",
      "-d",
      "--wait",
      "postgres",
      "minio",
    ],
  },
  {
    name: "harness-helper-tests",
    file: pnpm.file,
    args: [
      ...pnpm.prefix,
      "exec",
      "vitest",
      "run",
      "scripts/portability-harness-helpers.test.ts",
    ],
  },
  {
    name: "portability-destruction-reconstruction",
    file: pnpm.file,
    args: [
      ...pnpm.prefix,
      "--filter",
      "@trust-core/api",
      "test:portability:docker",
    ],
  },
];

let failed = !clean;
for (const definition of definitions) {
  const stageStarted = Date.now();
  process.stdout.write(`\n[Portability gate] ${definition.name}\n`);
  try {
    await run(definition.file, definition.args);
    stages.push({
      name: definition.name,
      status: "pass",
      durationMs: Date.now() - stageStarted,
    });
  } catch (error) {
    failed = true;
    stages.push({
      name: definition.name,
      status: "fail",
      durationMs: Date.now() - stageStarted,
      detail: safeFailureDetail(error),
    });
    break;
  }
}

const finished = Date.now();
const report = {
  release: "0.2",
  checkpoint: "0.2H",
  status: failed ? "fail" : "pass",
  clean,
  gitSha,
  startedAt,
  finishedAt: new Date(finished).toISOString(),
  durationMs: finished - started,
  environment: {
    platform: `${platform()} ${process.arch}`,
    node: process.version,
    docker: await optionalOutput("docker", [
      "version",
      "--format",
      "{{.Server.Os}} {{.Server.Version}}",
    ]),
  },
  stages,
};
await mkdir(reportsDirectory, { recursive: true });
await writeFile(jsonReport, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(markdownReportPath, markdownReport(report), "utf8");

if (failed) {
  process.stderr.write("\nTRUST TEST: FAIL\n");
  process.exitCode = 1;
} else {
  process.stdout.write("\nTRUST TEST: PASS\n");
}
process.stdout.write(`Reports: ${jsonReport} and ${markdownReportPath}\n`);

async function run(file, args) {
  await new Promise((resolvePromise, reject) => {
    const child = execFile(file, args, {
      cwd: root,
      env: { ...environment, FORCE_COLOR: "0" },
    });
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) return resolvePromise();
      reject(
        Object.assign(new Error("Gate stage failed."), {
          exitCode: code,
          signal,
        }),
      );
    });
  });
}

async function output(file, args) {
  const result = await execFileAsync(file, args, { cwd: root });
  return result.stdout.trim();
}

async function optionalOutput(file, args) {
  try {
    return await output(file, args);
  } catch {
    return null;
  }
}
