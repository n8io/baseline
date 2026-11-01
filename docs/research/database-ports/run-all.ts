// Runs each test file in its own process so OpenTelemetry patching stays isolated.
import { spawnSync } from "node:child_process";

console.log(`node ${process.version}`);
let failed = false;
for (const file of ["drizzle-bound", "otel", "pool", "bench", "plain-pg"]) {
  console.log(`\n# tests/${file}.test.ts`);
  const run = spawnSync(process.execPath, ["--expose-gc", `tests/${file}.test.ts`], { stdio: "inherit", cwd: import.meta.dirname });
  if (run.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
