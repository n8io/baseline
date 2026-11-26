// The GitHub half of app-create: merge settings, Dependabot, the CI ruleset, the repository and one CI run.
import { setTimeout } from "node:timers/promises";
import { processRun } from "../apps/app/scripts/process-run.ts";
import { rulesetReconcile } from "./app-create-ruleset.ts";

// Squash is the only way a pull request merges, and a merged branch goes away, which is what the
// ruleset's pull request rule allows.
export const mergeSettingsCall = (repository: string) => [
	"api",
	"--method",
	"PATCH",
	`repos/${repository}`,
	"-F",
	"allow_squash_merge=true",
	"-F",
	"allow_merge_commit=false",
	"-F",
	"allow_rebase_merge=false",
	"-F",
	"delete_branch_on_merge=true",
];

// Turns on Dependabot alerts, then Dependabot security updates, which need the alerts on.
export const securityUpdatesCalls = (repository: string) =>
	["vulnerability-alerts", "automated-security-fixes"].map((setting) => [
		"api",
		"--method",
		"PUT",
		`repos/${repository}/${setting}`,
	]);

type GhAsk = (args: string[]) => Promise<string>;

const ghAsk: GhAsk = async (args) => processRun({ command: "gh", args }).trim();

// Dispatches ci.yml on main and prints the new run's URL. GitHub indexes a new repository's
// workflows a few seconds after the push, so a missing workflow is retried (a ci.yml without
// workflow_dispatch, a release before it had one, is not), and the run takes a few more seconds to
// show in the list, so the list is polled. Only a failed dispatch says CI did not start.
export const ciDispatch = async ({
	attempts,
	gh,
	intervalMs,
	repository,
}: {
	attempts?: number | null;
	gh?: GhAsk | null;
	intervalMs?: number | null;
	repository: string;
}): Promise<string> => {
	const ask = gh ?? ghAsk;
	const limit = attempts ?? 20;
	const page = `https://github.com/${repository}/actions/workflows/ci.yml`;
	const since = new Date(Date.now() - 60_000).toISOString().slice(0, 19);
	for (let attempt = 1; ; attempt++) {
		try {
			await ask([
				"workflow",
				"run",
				"ci.yml",
				"--repo",
				repository,
				"--ref",
				"main",
			]);
			break;
		} catch (error) {
			if (
				attempt === Math.min(limit, 10) ||
				/workflow_dispatch/.test(String(error))
			) {
				return `Could not start CI on main; run it from ${page}`;
			}
			await setTimeout(intervalMs ?? 3_000);
		}
	}
	for (let attempt = 1; attempt <= limit; attempt++) {
		try {
			const url = await ask([
				"run",
				"list",
				"--repo",
				repository,
				"--workflow",
				"ci.yml",
				"--event",
				"workflow_dispatch",
				"--limit",
				"5",
				"--json",
				"url,createdAt",
				"--jq",
				`map(select(.createdAt >= "${since}")) | .[0].url // empty`,
			]);
			if (url !== "") return `CI is running on main: ${url}`;
		} catch {
			// The list is not up yet; ask again.
		}
		if (attempt < limit) await setTimeout(intervalMs ?? 3_000);
	}
	return `CI was started on main; its run has not shown up in the list yet, find it at ${page}`;
};

// owner/name from a git remote URL (https or ssh).
export const repositoryFromRemote = (url: string): string | null =>
	/github\.com[:/]([^/]+\/[^/]+?)(\.git)?\/?$/.exec(url.trim())?.[1] ?? null;

const originRead = (directory: string): string | null => {
	try {
		return repositoryFromRemote(
			processRun({
				command: "git",
				args: ["remote", "get-url", "origin"],
				options: { cwd: directory },
			}),
		);
	} catch {
		return null;
	}
};

// Creates the repository, or, when the render already has an origin (--github-only in a clone),
// uses that one. Then the ruleset (created, or updated to match), the merge settings, Dependabot,
// and one CI run on main.
export const githubCreate = async ({
	description,
	directory,
	owner,
	name,
}: {
	description: string;
	directory: string;
	name: string;
	owner: string | null;
}): Promise<void> => {
	let repository = originRead(directory);
	if (repository === null) {
		const login =
			owner ??
			processRun({
				command: "gh",
				args: ["api", "user", "--jq", ".login"],
			}).trim();
		repository = `${login}/${name}`;
		processRun({
			command: "gh",
			args: [
				"repo",
				"create",
				repository,
				"--private",
				"--description",
				description,
				"--source",
				directory,
				"--remote",
				"origin",
				"--push",
			],
			options: { inherit: true },
		});
	} else {
		console.log(`Using ${repository}, the render's origin`);
	}
	console.log(
		rulesetReconcile({
			gh: (args, input) =>
				processRun({
					command: "gh",
					args,
					options: input === undefined ? {} : { input },
				}),
			repository,
		}),
	);
	processRun({ command: "gh", args: mergeSettingsCall(repository) });
	for (const args of securityUpdatesCalls(repository))
		processRun({ command: "gh", args });
	console.log(`Set up https://github.com/${repository}`);
	console.log(await ciDispatch({ repository }));
};
