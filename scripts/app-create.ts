// pnpm app-create: makes a new Project from the latest app@ release, with no bounded context yet.
// Renders apps/app, writes the Project's answers, installs and commits, then creates the private
// GitHub repository, the CI ruleset, squash-only merging and Dependabot security updates, and runs CI once on main.
// --no-github stops after the commit; --github-only does the GitHub half inside an existing render.
// Flags skip the questions: --name --description [--owner]. docs/agents/project-create.md.
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { setTimeout } from "node:timers/promises";
import { parseArgs } from "node:util";
import { npmTarballsWait } from "../apps/app/scripts/npm-tarballs-wait.ts";
import { processRun } from "../apps/app/scripts/process-run.ts";
import {
	filesWrite,
	releaseLatest,
	type TemplateAnswers,
	type TemplateFile,
	templateAnswers,
	templateFetch,
	templateFinish,
	templateJsonRead,
} from "../apps/app/scripts/template-render.ts";
import { releaseRender } from "../apps/app/scripts/template-upgrade.ts";

// The app-ci.yml jobs a pull request must pass: every job there but `changes`, which only reads the
// diff for the others (glossary aliases warn inside `check`).
export const requiredJobs = [
	"check",
	"unit",
	"integration",
	"pieces",
	"image",
	"sast",
] as const;

// The monorepo's apps/app, whose node_modules hold the Biome and varlock the render runs.
export const toolsDirectory = resolve(import.meta.dirname, "../apps/app");

// invoice-line ↔ **Invoice line**:, the glossary term context-create and aggregate-create look for.
export const glossaryTerm = (kebab: string): string => {
	const words = kebab.replaceAll("-", " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
};

// Renders a release's files with that release's own render code into a new directory.
export const appRender = async ({
	answers,
	directory,
	files,
}: {
	answers: TemplateAnswers;
	directory: string;
	files: TemplateFile[];
}): Promise<void> => {
	filesWrite(directory, await releaseRender(files, answers));
	templateFinish(directory, toolsDirectory);
};

// A fresh AUTHN_SECRET for development.
export const envFilesWrite = (directory: string): void => {
	const development = join(directory, ".env.development");
	writeFileSync(
		development,
		readFileSync(development, "utf8").replace(
			/^AUTHN_SECRET=.*$/m,
			`AUTHN_SECRET=${randomBytes(32).toString("base64url")}`,
		),
	);
};

// Writes the answers a rendered project keeps: env files and .template.json.
export const answersWrite = ({
	answers,
	directory,
}: {
	answers: TemplateAnswers & { release: string };
	directory: string;
}): void => {
	envFilesWrite(directory);
	writeFileSync(
		join(directory, ".template.json"),
		`${JSON.stringify(
			{
				description: answers.description,
				release: answers.release,
			},
			null,
			"\t",
		)}\n`,
	);
};

// Runs pnpm with its output shown and throws when it fails (apps/app/scripts/pieces.ts has a
// pnpmRun that returns the result instead).
export const pnpmInheritRun = (directory: string, args: string[]): void => {
	processRun({
		command: "pnpm",
		args,
		options: { cwd: directory, inherit: true },
	});
};

export const gitCommitAll = (directory: string, message: string): void => {
	if (!existsSync(join(directory, ".git"))) {
		processRun({
			command: "git",
			args: ["init", "--quiet", "--initial-branch=main"],
			options: {
				cwd: directory,
			},
		});
	}
	processRun({
		command: "git",
		args: ["add", "--all"],
		options: { cwd: directory },
	});
	processRun({
		command: "git",
		args: ["commit", "--quiet", "--message", message],
		options: { cwd: directory },
	});
};

type Rule = { parameters?: Record<string, unknown>; type: string };
type Ruleset = {
	bypass_actors: unknown[];
	conditions: { ref_name: { exclude: string[]; include: string[] } };
	enforcement: string;
	name: string;
	rules: Rule[];
	target: string;
};

// The ruleset on the default branch, the rules baseline's own main has: no deletion, no force
// push, a pull request with squash as the only merge method and no required approvals (so a
// Dependabot merge with GITHUB_TOKEN still works), and every required app-ci.yml job as
// `ci / <job>`. No bypass actors.
export const rulesetBodyCreate = (): Ruleset => ({
	bypass_actors: [],
	conditions: { ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] } },
	enforcement: "active",
	name: "ci",
	rules: [
		{ type: "deletion" },
		{ type: "non_fast_forward" },
		{
			parameters: {
				allowed_merge_methods: ["squash"],
				dismiss_stale_reviews_on_push: false,
				require_code_owner_review: false,
				require_last_push_approval: false,
				required_approving_review_count: 0,
				required_review_thread_resolution: false,
			},
			type: "pull_request",
		},
		{
			parameters: {
				do_not_enforce_on_create: false,
				required_status_checks: requiredJobs.map((job) => ({
					context: `ci / ${job}`,
				})),
				strict_required_status_checks_policy: false,
			},
			type: "required_status_checks",
		},
	],
	target: "branch",
});

// The fields a ruleset is judged by, in a fixed order: GitHub's answer also carries ids, dates
// and defaults the body never sets, and lists rules and checks in no stable order.
// The parameters under the given keys, in key order: GitHub adds defaults the body never sets
// (required_reviewers) and answers in its own key order.
const parametersPick = ({
	keys,
	parameters,
}: {
	keys: string[];
	parameters: Record<string, unknown> | undefined;
}) =>
	Object.fromEntries(keys.toSorted().map((key) => [key, parameters?.[key]]));

const rulesetNormalize = ({
	ruleset,
	shape,
}: {
	ruleset: Partial<Ruleset>;
	shape: Ruleset;
}) => ({
	bypass_actors: ruleset.bypass_actors ?? [],
	conditions: ruleset.conditions,
	enforcement: ruleset.enforcement,
	rules: Object.fromEntries(
		((ruleset.rules ?? []) as Rule[])
			.map(({ parameters, type }): [string, unknown] => [
				type,
				type === "required_status_checks"
					? {
							checks: (
								(parameters?.["required_status_checks"] ?? []) as {
									context: string;
								}[]
							)
								.map(({ context }) => context)
								.sort(),
							create: parameters?.["do_not_enforce_on_create"],
							strict: parameters?.["strict_required_status_checks_policy"],
						}
					: parametersPick({
							keys: Object.keys(
								shape.rules.find((rule) => rule.type === type)?.parameters ??
									{},
							),
							parameters,
						}),
			])
			.sort(([a], [b]) => a.localeCompare(b)),
	),
	target: ruleset.target,
});

// What differs between the ruleset on GitHub and the wanted one, as short phrases; empty when
// they are the same.
export const rulesetChangesFind = ({
	current,
	wanted,
}: {
	current: Partial<Ruleset>;
	wanted: Ruleset;
}): string[] => {
	const have = rulesetNormalize({ ruleset: current, shape: wanted });
	const want = rulesetNormalize({ ruleset: wanted, shape: wanted });
	const changes: string[] = [];
	for (const field of [
		"bypass_actors",
		"conditions",
		"enforcement",
		"target",
	] as const) {
		if (JSON.stringify(have[field]) !== JSON.stringify(want[field]))
			changes.push(`changed ${field}`);
	}
	for (const type of new Set([
		...Object.keys(have.rules),
		...Object.keys(want.rules),
	])) {
		if (!(type in have.rules)) changes.push(`added rule ${type}`);
		else if (!(type in want.rules)) changes.push(`removed rule ${type}`);
		else if (
			JSON.stringify(have.rules[type]) !== JSON.stringify(want.rules[type])
		)
			changes.push(
				`changed rule ${type}${checksChangeDescribe(
					have.rules[type] as Checks,
					want.rules[type] as Checks,
				)}`,
			);
	}
	return changes;
};

type Checks = { checks?: string[] };

// Which required checks a change adds and removes, so an upgrade can see it only drops checks.
const checksChangeDescribe = (have: Checks, want: Checks): string => {
	const added = (want.checks ?? []).filter((c) => !have.checks?.includes(c));
	const removed = (have.checks ?? []).filter((c) => !want.checks?.includes(c));
	const named = [
		...(added.length > 0 ? [`added ${added.join(", ")}`] : []),
		...(removed.length > 0 ? [`removed ${removed.join(", ")}`] : []),
	];
	return named.length > 0 ? ` (${named.join("; ")})` : "";
};

type Gh = (args: string[], input?: string | undefined) => string;

// Makes the ruleset named ci match rulesetBodyCreate(): creates it when missing, updates it when
// it differs (and says what changed), and makes no write when it already matches.
export const rulesetReconcile = ({
	gh,
	repository,
}: {
	gh: Gh;
	repository: string;
}): string => {
	const wanted = rulesetBodyCreate();
	const path = `repos/${repository}/rulesets`;
	const listed = JSON.parse(gh(["api", `${path}?includes_parents=false`])) as {
		id: number;
		name: string;
	}[];
	const found = listed.find(({ name }) => name === wanted.name);
	if (found === undefined) {
		gh(
			["api", "--method", "POST", path, "--input", "-"],
			JSON.stringify(wanted),
		);
		return `Created the ${wanted.name} ruleset on ${repository}`;
	}
	const current = JSON.parse(gh(["api", `${path}/${found.id}`])) as Ruleset;
	const changes = rulesetChangesFind({ current, wanted });
	if (changes.length === 0)
		return `${repository} already has the ${wanted.name} ruleset as wanted`;
	gh(
		["api", "--method", "PUT", `${path}/${found.id}`, "--input", "-"],
		JSON.stringify(wanted),
	);
	return `Updated the ${wanted.name} ruleset on ${repository}: ${changes.join(", ")}`;
};

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

// The monorepo this script runs from, whose .changeset/ and apps/app version say what main holds.
const monorepo = resolve(import.meta.dirname, "..");

// The folder the person ran the command in: pnpm runs a script from the monorepo root.
const startDirectory = (): string =>
	// biome-ignore lint/suspicious/noUndeclaredEnvVars: pnpm sets it; turbo never runs app-create
	process.env["INIT_CWD"] ?? process.cwd();

export type AppCreateArgs = {
	description: string | null;
	// all: render, then GitHub. render: --no-github. github: --github-only.
	mode: "all" | "github" | "render";
	name: string | null;
	owner: string | null;
};

export const appCreateArgsRead = (args: string[]): AppCreateArgs => {
	const { values } = parseArgs({
		allowNegative: true,
		args,
		options: {
			description: { type: "string" },
			github: { default: true, type: "boolean" },
			"github-only": { default: false, type: "boolean" },
			name: { type: "string" },
			owner: { type: "string" },
		},
	});
	if (values["github-only"] && !values.github) {
		throw new Error("--github-only and --no-github cannot go together");
	}
	if (
		values["github-only"] &&
		(values.name !== undefined || values.description !== undefined)
	) {
		throw new Error(
			"--github-only reads the name and description from the render it runs in",
		);
	}
	return {
		description: values.description ?? null,
		mode: values["github-only"] ? "github" : values.github ? "all" : "render",
		name: values.name ?? null,
		owner: values.owner ?? null,
	};
};

// Says when a new Project will not get what baseline main holds: changesets merged since the
// newest release, or a checkout whose Template version is not that release.
export const releaseWarning = ({
	changesets,
	checkoutRelease,
	release,
}: {
	changesets: number;
	checkoutRelease: string;
	release: string;
}): string | null => {
	if (checkoutRelease !== release) {
		return `This baseline checkout is app@${checkoutRelease} and the newest release is app@${release}; this Project gets app@${release}.`;
	}
	if (changesets === 0) return null;
	return `main holds ${changesets} unreleased changeset${changesets === 1 ? "" : "s"}; this Project gets app@${release}.`;
};

const releaseWarningRead = (release: string): string | null =>
	releaseWarning({
		changesets: readdirSync(join(monorepo, ".changeset")).filter(
			(file) => file.endsWith(".md") && file !== "README.md",
		).length,
		checkoutRelease: (
			JSON.parse(
				readFileSync(join(monorepo, "apps/app/package.json"), "utf8"),
			) as { version: string }
		).version,
		release,
	});

type PackageVersion = { name: string; version: string };

// The @n8io/baseline-* versions a rendered package.json pins: ^2.1.0 needs 2.1.0 on npm.
export const baselinePackagesPinned = (manifest: string): PackageVersion[] =>
	Object.entries(
		(JSON.parse(manifest) as { dependencies?: Record<string, string> })
			.dependencies ?? {},
	)
		.filter(([name]) => name.startsWith("@n8io/baseline-"))
		.map(([name, range]) => ({ name, version: range.replace(/^[\^~]/, "") }));

// npm serves a fresh release minutes after it publishes. Polls each version until the registry
// answers, with one status line, and fails after `timeoutMs`.
export const npmVersionsWait = async ({
	intervalMs,
	log,
	packages,
	registry,
	timeoutMs,
}: {
	intervalMs?: number | null;
	log?: ((line: string) => void) | null;
	packages: PackageVersion[];
	registry?: string | null;
	timeoutMs?: number | null;
}): Promise<void> => {
	const interval = intervalMs ?? 15_000;
	const timeout = timeoutMs ?? 15 * 60_000;
	const deadline = Date.now() + timeout;
	let missing = packages;
	let waiting = false;
	for (;;) {
		const served = await Promise.all(
			missing.map(async ({ name, version }) => {
				try {
					const response = await fetch(
						`${registry ?? "https://registry.npmjs.org"}/${name}/${version}`,
					);
					await response.body?.cancel();
					return response.ok;
				} catch {
					return false;
				}
			}),
		);
		missing = missing.filter((_, index) => !served[index]);
		if (missing.length === 0) return;
		const names = missing.map((p) => `${p.name}@${p.version}`).join(", ");
		if (Date.now() + interval > deadline) {
			throw new Error(
				`npm still does not serve ${names} after ${timeout / 60_000} min`,
			);
		}
		if (!waiting) {
			(log ?? console.log)(
				`Waiting for npm to serve ${names}: a fresh release takes a few minutes. Checking every ${interval / 1000} s for up to ${timeout / 60_000} min.`,
			);
			waiting = true;
		}
		await setTimeout(interval);
	}
};

const githubSteps = ({
	description,
	directory,
	name,
	owner,
}: {
	description: string;
	directory: string;
	name: string;
	owner: string | null;
}): string =>
	[
		"The GitHub half, on a machine where `gh auth status` is signed in:",
		`  1. gh repo create ${owner ?? "<owner>"}/${name} --private --description '${description.replaceAll("'", "'\\''")}' --source ${directory} --remote origin --push`,
		`  2. a ruleset on the default branch: no deletion, no force push, squash-merged pull requests only, and ${requiredJobs.map((job) => `ci / ${job}`).join(", ")} required`,
		"  3. squash-only merging with merged branches deleted",
		"  4. Dependabot alerts, then Dependabot security updates",
		`Inside ${directory}, \`pnpm -C ${monorepo} app-create --github-only\` does all four and runs CI once on main.`,
	].join("\n");

const nextSteps = (directory: string): string =>
	[
		`Next: cd ${directory} && pnpm dev`,
		"Then add your first context's row to CONTEXT-MAP.md, run `pnpm context-create <context>`, add its Aggregate's term to the context's CONTEXT.md, then `pnpm aggregate-create <context> <aggregate> --bare` (docs/agents/context-create.md).",
	].join("\n");

const kebabPattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

const answersAsk = async (
	args: AppCreateArgs,
): Promise<{ description: string; name: string }> => {
	const prompt = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	const ask = async (given: string | null, question: string) =>
		given ?? (await prompt.question(`${question} `)).trim();
	try {
		const name = await ask(args.name, "Repository name (kebab-case):");
		const description = await ask(
			args.description,
			"One-line project description:",
		);
		if (!kebabPattern.test(name)) {
			throw new Error(`name "${name}" is not kebab-case`);
		}
		if (description === "") throw new Error("the description is required");
		return { description, name };
	} finally {
		prompt.close();
	}
};

const projectRender = async (answers: TemplateAnswers): Promise<string> => {
	const directory = resolve(startDirectory(), answers.name);
	if (existsSync(directory)) throw new Error(`${directory} already exists`);
	const release = releaseLatest();
	const warning = releaseWarningRead(release);
	if (warning !== null) console.log(warning);
	console.log(`Rendering app@${release} into ${directory}`);
	try {
		const files = templateFetch(release);
		await appRender({ directory, files, answers });
		answersWrite({
			directory,
			answers: { ...answers, release },
		});
		await npmVersionsWait({
			packages: baselinePackagesPinned(
				readFileSync(join(directory, "package.json"), "utf8"),
			),
		});
		// The template's lockfile drops our own packages, so this install adds them, resolved first
		// so their tarballs can be awaited.
		pnpmInheritRun(directory, [
			"install",
			"--lockfile-only",
			"--no-frozen-lockfile",
		]);
		await npmTarballsWait({ directory });
		pnpmInheritRun(directory, ["install", "--no-frozen-lockfile"]);
		gitCommitAll(directory, `🎉 Create ${answers.name} from app@${release}`);
	} catch (error) {
		console.error(
			`app-create: stopped before creating the repository; ${directory} holds the partial render`,
		);
		throw error;
	}
	return directory;
};

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
const githubCreate = async ({
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

const main = async () => {
	const args = appCreateArgsRead(process.argv.slice(2));
	if (args.mode === "github") {
		const directory = startDirectory();
		if (!existsSync(join(directory, ".template.json"))) {
			throw new Error(
				`${directory} is not a render: run --github-only inside the folder app-create made`,
			);
		}
		const { description, name } = templateAnswers(
			directory,
			templateJsonRead(directory),
		);
		await githubCreate({ description, directory, name, owner: args.owner });
		console.log(nextSteps(directory));
		return;
	}
	const answers = await answersAsk(args);
	const directory = await projectRender(answers);
	if (args.mode === "render") {
		console.log(
			`Rendered and committed ${directory}; nothing exists on GitHub yet.`,
		);
		console.log(githubSteps({ ...answers, directory, owner: args.owner }));
	} else {
		await githubCreate({ ...answers, directory, owner: args.owner });
	}
	console.log(nextSteps(directory));
};

if (import.meta.main) {
	try {
		await main();
	} catch (error) {
		console.error(`app-create: ${(error as Error).message}`);
		process.exitCode = 1;
	}
}
