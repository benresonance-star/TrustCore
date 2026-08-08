import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { platform } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const reportsDirectory = resolve(root, "reports");
const jsonReport = resolve(reportsDirectory, "release-0.1-docker-gate.json");
const markdownReport = resolve(reportsDirectory, "release-0.1-docker-gate.md");
const started = Date.now();
const startedAt = new Date(started).toISOString();
const stages = [];
const gateEnvironment = {
  ...process.env,
  POSTGRES_INTEGRATION: "1",
  TRUST_DOCKER_TESTS: "1",
  POSTGRES_ADMIN_URL: process.env.POSTGRES_ADMIN_URL
    ?? "postgresql://trust_admin:trust_admin_local_only@localhost:54329/trust_core",
  TRUST_STORAGE_ENDPOINT: process.env.TRUST_STORAGE_ENDPOINT ?? "http://localhost:5900",
  TRUST_STORAGE_REGION: process.env.TRUST_STORAGE_REGION ?? "us-east-1",
  TRUST_STORAGE_BUCKET: process.env.TRUST_STORAGE_BUCKET ?? "trust-core-local",
  TRUST_STORAGE_ACCESS_KEY: process.env.TRUST_STORAGE_ACCESS_KEY ?? "trustcore",
  TRUST_STORAGE_SECRET_KEY: process.env.TRUST_STORAGE_SECRET_KEY ?? "trustcore-local-secret",
  TRUST_STORAGE_FORCE_PATH_STYLE: process.env.TRUST_STORAGE_FORCE_PATH_STYLE ?? "true",
};

const packageManager = process.env.npm_execpath
  ? { file: process.execPath, prefix: [process.env.npm_execpath] }
  : { file: "pnpm", prefix: [] };

const stageDefinitions = [
  { name: "compose-configuration", file: "docker", args: ["compose", "config", "--quiet"] },
  {
    name: "service-readiness-and-bucket-init",
    file: packageManager.file,
    args: [...packageManager.prefix, "docker:up"],
  },
  {
    name: "postgres-migrations-roles-rls",
    file: packageManager.file,
    args: [...packageManager.prefix, "--filter", "@trust-core/persistence-postgres", "test:docker"],
  },
  {
    name: "minio-storage-contract",
    file: packageManager.file,
    args: [...packageManager.prefix, "--filter", "@trust-core/storage-minio", "test:docker"],
  },
  {
    name: "s3-storage-contract",
    file: packageManager.file,
    args: [...packageManager.prefix, "--filter", "@trust-core/storage-s3", "test:docker"],
  },
  {
    name: "live-api-worker-integration",
    file: packageManager.file,
    args: [...packageManager.prefix, "--filter", "@trust-core/api", "test:docker"],
  },
  {
    name: "process-interruption-reconciliation",
    file: packageManager.file,
    args: [...packageManager.prefix, "--filter", "@trust-core/api", "test:interruption:docker"],
  },
];

let failed = false;
for (const definition of stageDefinitions) {
  if (failed) {
    stages.push({ name: definition.name, status: "skipped", durationMs: 0 });
    continue;
  }

  const stageStarted = Date.now();
  process.stdout.write(`\n[Docker gate] ${definition.name}\n`);
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
  }
}

if (!failed) {
  const stageStarted = Date.now();
  try {
    await run("docker", ["compose", "down"]);
    stages.push({
      name: "scoped-service-stop",
      status: "pass",
      durationMs: Date.now() - stageStarted,
    });
  } catch (error) {
    failed = true;
    stages.push({
      name: "scoped-service-stop",
      status: "fail",
      durationMs: Date.now() - stageStarted,
      detail: safeFailureDetail(error),
    });
  }
}

const finished = Date.now();
const report = {
  release: "0.1",
  status: failed ? "fail" : "pass",
  startedAt,
  finishedAt: new Date(finished).toISOString(),
  durationMs: finished - started,
  environment: {
    platform: `${platform()} ${process.arch}`,
    node: process.version,
    docker: await versionOf("docker", ["version", "--format", "{{.Server.Os}} {{.Server.Version}}"]),
    commit: await optionalVersionOf("git", ["rev-parse", "HEAD"]),
  },
  stages,
};

await mkdir(reportsDirectory, { recursive: true });
await writeFile(jsonReport, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(markdownReport, markdown(report), "utf8");

if (failed) {
  process.stderr.write("\nTRUST TEST: FAIL\n");
  process.stderr.write(`Reports: ${jsonReport} and ${markdownReport}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("\nTRUST TEST: PASS\n");
  process.stdout.write(`Reports: ${jsonReport} and ${markdownReport}\n`);
}

async function run(file, args) {
  await new Promise((resolvePromise, reject) => {
    const child = execFile(file, args, {
      cwd: root,
      env: { ...gateEnvironment, FORCE_COLOR: "0" },
    });

    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      const error = new Error("Docker gate stage failed");
      error.exitCode = code;
      error.signal = signal;
      reject(error);
    });
  });
}

async function versionOf(file, args) {
  const result = await execFileAsync(file, args, { cwd: root });
  return result.stdout.trim();
}

async function optionalVersionOf(file, args) {
  try {
    return await versionOf(file, args);
  } catch {
    return null;
  }
}

function safeFailureDetail(error) {
  const exitCode = error && typeof error === "object" && "exitCode" in error
    ? error.exitCode
    : null;
  const signal = error && typeof error === "object" && "signal" in error
    ? error.signal
    : null;
  if (exitCode !== null && exitCode !== undefined) return `Command exited with code ${exitCode}.`;
  if (signal) return `Command terminated by signal ${signal}.`;
  return "Stage could not be started or completed; inspect the console output.";
}

function markdown(value) {
  const lines = [
    "# Trust Core Release 0.1 Docker gate",
    "",
    `- Status: **${value.status.toUpperCase()}**`,
    `- Started: ${value.startedAt}`,
    `- Finished: ${value.finishedAt}`,
    `- Duration: ${value.durationMs} ms`,
    `- Platform: ${value.environment.platform}`,
    `- Node: ${value.environment.node}`,
    `- Docker: ${value.environment.docker}`,
    `- Commit: ${value.environment.commit ?? "uncommitted source snapshot"}`,
    "",
    "## Stages",
    "",
  ];
  for (const stage of value.stages) {
    lines.push(`- ${stage.name}: ${stage.status.toUpperCase()} (${stage.durationMs} ms)`);
    if (stage.detail) lines.push(`  - ${stage.detail}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}
