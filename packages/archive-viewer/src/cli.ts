#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { renderArchiveBytes } from "./index.js";

export interface ViewerCliIo {
  readonly read: (path: string) => Promise<Uint8Array>;
  readonly write: (path: string, contents: string) => Promise<void>;
  readonly log: (message: string) => void;
  readonly error: (message: string) => void;
}

const defaultIo: ViewerCliIo = {
  read: readFile,
  write: (path, contents) => writeFile(path, contents, "utf8"),
  log: console.log,
  error: console.error,
};

export async function runViewerCli(
  args: readonly string[],
  io: ViewerCliIo = defaultIo,
): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    io.log(usage);
    return 0;
  }
  const input = args[0];
  if (!input) {
    io.error(usage);
    return 2;
  }
  const outputFlag = args.indexOf("--output");
  const output =
    outputFlag >= 0 && args[outputFlag + 1]
      ? args[outputFlag + 1]!
      : `${basename(input).replace(/\.trustarchive$/i, "") || "archive"}.html`;
  try {
    const html = await renderArchiveBytes(await io.read(resolve(input)));
    await io.write(resolve(output), html);
    io.log(`Verified archive and wrote read-only viewer: ${resolve(output)}`);
    return 0;
  } catch (error) {
    io.error(
      `Viewer refused the archive: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return 1;
  }
}

const usage =
  "Usage: trust-archive-viewer <archive.trustarchive> [--output archive.html]";

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await runViewerCli(process.argv.slice(2));
}
