// pnpm test:mutation: Stryker on the source files changed against origin/main.
import { execFileSync, spawnSync } from "node:child_process";

// Files only the integration project can cover (Postgres and Redis adapters, tables, the
// composition roots and the route table), so unit-test mutants there always survive.
const integrationOnly = [
	/\.(postgres|redis)\.ts$/,
	/-table\.ts$/,
	/^src\/(server|worker|seed)\.ts$/,
	/^src\/ui\/(routes|context)\.ts$/,
];

// The changed paths Stryker mutates: source files, never tests, contracts, types or the above.
export const mutationTargets = (changed: string[]): string[] =>
	changed.filter(
		(file) =>
			/\.tsx?$/.test(file) &&
			!/\.(test|contract)\.ts$/.test(file) &&
			!file.endsWith(".d.ts") &&
			!integrationOnly.some((pattern) => pattern.test(file)),
	);

const main = () => {
	const changed = mutationTargets(
		execFileSync(
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
		).split("\n"),
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
};

if (import.meta.main) main();
