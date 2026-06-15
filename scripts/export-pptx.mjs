import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const serviceCli = path.join(
  repoRoot,
  "services",
  "editable-pptx",
  "src",
  "cli",
  "export-editable-pptx.mjs",
);

const child = spawn(process.execPath, [serviceCli, ...process.argv.slice(2)], {
  cwd: repoRoot,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

