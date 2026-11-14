// pnpm check: generates what the checks read (env types, route types), then runs Biome and tsc
// and reports both, so one run shows every failure instead of the first. Exits non-zero when
// either failed. Route types are wiped just before they are generated, so a deleted page leaves no
// stale type behind and a failed codegen leaves the old ones.
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

type Step = { args: string[]; command: string };

// Generators stop the run when they fail (nothing downstream can be trusted); checks never do.
export const checksPlanCreate = ({
	uiIs,
}: {
	uiIs: boolean;
}): { checks: Step[]; generators: Step[] } => ({
	generators: [
		{ command: "varlock", args: ["codegen"] },
		...(uiIs ? [{ command: "react-router", args: ["typegen"] }] : []),
	],
	checks: [
		{ command: "biome", args: ["check", "."] },
		{ command: "tsc", args: ["--noEmit"] },
	],
});

export const checksRun = ({
	plan,
	stepRun,
}: {
	plan: ReturnType<typeof checksPlanCreate>;
	stepRun: (step: Step) => number;
}): { failed: string[] } => {
	for (const step of plan.generators) {
		if (stepRun(step) !== 0) return { failed: [step.command] };
	}
	const failed: string[] = [];
	for (const step of plan.checks) {
		if (stepRun(step) !== 0) failed.push(step.command);
	}
	return { failed };
};

const main = () => {
	const uiIs = existsSync("react-router.config.ts");
	const { failed } = checksRun({
		plan: checksPlanCreate({ uiIs }),
		stepRun: (step) => {
			if (step.command === "react-router") {
				rmSync(".react-router/types", { force: true, recursive: true });
			}
			const result = spawnSync(step.command, step.args, { stdio: "inherit" });
			if (result.error) console.error(result.error.message);
			return result.status ?? 1;
		},
	});
	if (failed.length > 0) {
		console.error(`check failed: ${failed.join(", ")}`);
		process.exitCode = 1;
	}
};

if (import.meta.main) main();
