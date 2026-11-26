// Maintainer script: part of baseline's own agent workflow, never rendered into a Project.
// Waits on a pull request's checks and says what they are doing. A check that was cancelled (a job that
// hit its time limit sends no event) counts as red; the first time it shows up, its run is re-run once.
// Usage: node scripts/ci-watch.ts <pull request number> [--repo owner/name] [--every <seconds>]
// Needs GITHUB_TOKEN, or `gh auth token` to work. Exit code 0: all green, 1: red, 2: gave up waiting.
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

export type CiWatchCheck = {
	conclusion: string | null;
	name: string;
	status: string;
};

export type CiWatchState = "green" | "pending" | "red";

const redConclusions = new Set([
	"action_required",
	"cancelled",
	"failure",
	"startup_failure",
	"timed_out",
]);
const doneConclusions = new Set(["neutral", "skipped", "success"]);

// `pending` while any check still runs, `red` once every check finished and one did not pass; a red
// check does not wait for the rest, since the Pull request cannot merge anyway.
export const ciWatchStateRead = (checks: CiWatchCheck[]): CiWatchState => {
	if (
		checks.some(
			(c) => c.status === "completed" && redConclusions.has(c.conclusion ?? ""),
		)
	) {
		return "red";
	}
	return checks.length > 0 &&
		checks.every(
			(c) =>
				c.status === "completed" && doneConclusions.has(c.conclusion ?? ""),
		)
		? "green"
		: "pending";
};

export const ciWatchCancelledNames = (checks: CiWatchCheck[]): string[] =>
	checks
		.filter((c) => c.status === "completed" && c.conclusion === "cancelled")
		.map((c) => c.name);

export const ciWatchLineWrite = (checks: CiWatchCheck[]): string => {
	const count = (test: (c: CiWatchCheck) => boolean) =>
		checks.filter(test).length;
	const failed = checks
		.filter(
			(c) => c.status === "completed" && redConclusions.has(c.conclusion ?? ""),
		)
		.map((c) => `${c.name} (${c.conclusion})`);
	return [
		`${ciWatchStateRead(checks)}:`,
		`${count((c) => c.status === "completed" && doneConclusions.has(c.conclusion ?? ""))} passed,`,
		`${count((c) => c.status !== "completed")} running,`,
		`${failed.length} failed${failed.length > 0 ? ` [${failed.join(", ")}]` : ""}`,
	].join(" ");
};

type CiWatchApi = (path: string, init?: RequestInit) => Promise<unknown>;

const ciWatchApiCreate =
	(token: string): CiWatchApi =>
	async (path, init) => {
		const response = await fetch(`https://api.github.com${path}`, {
			...init,
			headers: {
				accept: "application/vnd.github+json",
				authorization: `Bearer ${token}`,
			},
		});
		if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
		return response.status === 204 || response.status === 201
			? undefined
			: response.json();
	};

type CheckRun = CiWatchCheck & { details_url: string | null };

export const ciWatch = async ({
	api,
	every,
	pull,
	repo,
	sleep,
	write,
}: {
	api: CiWatchApi;
	every: number;
	pull: number;
	repo: string;
	sleep: (seconds: number) => Promise<void>;
	write: (line: string) => void;
}): Promise<0 | 1 | 2> => {
	const rerun = new Set<string>();
	// At the default minute between polls, one hour is the limit.
	for (let poll = 0; poll < 60; poll++) {
		const { head } = (await api(`/repos/${repo}/pulls/${pull}`)) as {
			head: { sha: string };
		};
		const { check_runs: checks } = (await api(
			`/repos/${repo}/commits/${head.sha}/check-runs?per_page=100`,
		)) as { check_runs: CheckRun[] };
		write(ciWatchLineWrite(checks));
		let reran = false;
		for (const check of checks) {
			const run = /\/actions\/runs\/(\d+)/.exec(check.details_url ?? "")?.[1];
			if (
				check.status === "completed" &&
				check.conclusion === "cancelled" &&
				run &&
				!rerun.has(run)
			) {
				rerun.add(run);
				reran = true;
				write(`re-running run ${run} once: ${check.name} was cancelled`);
				await api(`/repos/${repo}/actions/runs/${run}/rerun-failed-jobs`, {
					method: "POST",
				});
			}
		}
		const state = ciWatchStateRead(checks);
		if (!reran && state === "green") return 0;
		if (!reran && state === "red") return 1;
		await sleep(every);
	}
	return 2;
};

if (import.meta.main) {
	const { positionals, values } = parseArgs({
		allowPositionals: true,
		options: {
			every: { default: "60", type: "string" },
			repo: { default: "n8io/baseline", type: "string" },
		},
	});
	const pull = Number(positionals[0]);
	if (!Number.isInteger(pull)) {
		console.error(
			"Usage: node scripts/ci-watch.ts <pull request number> [--repo owner/name] [--every <seconds>]",
		);
		process.exitCode = 1;
	} else {
		// biome-ignore lint/suspicious/noUndeclaredEnvVars: a script run by hand, outside any Turborepo task.
		const fromEnv = process.env["GITHUB_TOKEN"];
		const token =
			fromEnv ??
			execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
		process.exitCode = await ciWatch({
			api: ciWatchApiCreate(token),
			every: Number(values.every),
			pull,
			repo: values.repo,
			sleep: (seconds) =>
				new Promise((done) => setTimeout(done, seconds * 1000)),
			write: (line) => console.log(`${new Date().toISOString()} ${line}`),
		});
	}
}
