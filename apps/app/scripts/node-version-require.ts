// Preloaded by every package.json script (`node --import ./scripts/node-version-require.ts`), so
// an older Node stops with what it needs before it loads a script it cannot run: a preload is
// evaluated before the script's imports are parsed. It uses only what Node 22 can run.
import { readFileSync } from "node:fs";

const { engines } = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { engines: { node: string } };
const required = Number(/\d+/.exec(engines.node)?.[0]);
const found = process.versions.node;

if (Number(found.split(".")[0]) < required) {
	console.error(`This script needs Node ${required}, found ${found}.`);
	process.exit(1);
}
