import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { release01OpenApi } from "./release01-contract.js";

const output = resolve(process.cwd(), "../../contracts/openapi.json");
await writeFile(
  output,
  `${JSON.stringify(release01OpenApi, null, 2)}\n`,
  "utf8",
);
process.stdout.write(`Generated ${output}\n`);
