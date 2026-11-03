// pnpm test:mutation: Stryker on the source files changed against origin/main.
import { execFileSync, spawnSync } from "node:child_process";

const changed = execFileSync(
	"git",
	[
		"diff",
		"--name-only",
		"--relative",
		"--diff-filter=AMR",
		"origin/main...HEAD",
		"--",
		"src",
	],
	{ encoding: "utf8" },
)
	.split("\n")
	.filter(
		(file) =>
			/\.tsx?$/.test(file) &&
			!/\.(test|contract)\.ts$/.test(file) &&
			!file.endsWith(".d.ts"),
	);

if (changed.length === 0) {
	console.log(
		"No source files changed against origin/main; nothing to mutate.",
	);
	process.exit(0);
}

const { status } = spawnSync(
	"pnpm",
	["exec", "stryker", "run", "--mutate", changed.join(",")],
	{ env: { ...process.env, TEST_MUTATION: "1" }, stdio: "inherit" },
);
process.exit(status ?? 1);
