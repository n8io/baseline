// pnpm app-create: makes a new Project from the latest app@ release, with no Domain yet.
// Renders apps/app, writes the Project's answers, installs and commits, then creates the private
// GitHub repository, the CI ruleset and Dependabot security updates, and runs CI once on main.
// --no-github stops after the commit; --github-only does the GitHub half inside an existing render.
// Flags skip the questions: --name --description [--owner]. docs/agents/project-create.md.
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { setTimeout } from "node:timers/promises";
import { parseArgs } from "node:util";
import {
	filesWrite,
	releaseLatest,
	run,
	type TemplateAnswers,
	type TemplateFile,
	templateAnswers,
	templateFetch,
	templateFinish,
	templateJsonRead,
} from "../apps/app/scripts/template-render.ts";
import { releaseRender } from "../apps/app/scripts/template-upgrade.ts";

type GlossaryTerm = { term: string; definition: string };

// The app-ci.yml jobs a pull request must pass; glossary-check only warns.
export const requiredJobs = [
	"check",
	"unit",
	"integration",
	"migrations",
	"oasdiff",
	"pieces",
	"image",
	"sast",
] as const;

// The monorepo's apps/app, whose node_modules hold the Biome and varlock the render runs.
export const toolsDirectory = resolve(import.meta.dirname, "../apps/app");

// invoice-line ↔ **Invoice line**:, the glossary term domain-create looks for.
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

// Puts the project's terms under CONTEXT.md's `## Language`, which the render leaves empty.
export const contextLanguageWrite = (text: string, terms: GlossaryTerm[]) => {
	if (terms.length === 0) return text;
	const entries = terms.map((t) => `**${t.term}**:\n${t.definition}\n`);
	return `${text.trimEnd()}\n\n${entries.join("\n")}`;
};

// A fresh AUTHN_SECRET for development, and the project's own 1Password vault in production.
export const envFilesWrite = (directory: string, name: string): void => {
	const development = join(directory, ".env.development");
	writeFileSync(
		development,
		readFileSync(development, "utf8").replace(
			/^AUTHN_SECRET=.*$/m,
			`AUTHN_SECRET=${randomBytes(32).toString("base64url")}`,
		),
	);
	const production = join(directory, ".env.production");
	writeFileSync(
		production,
		readFileSync(production, "utf8").replaceAll(
			/op:\/\/[^/]+\//g,
			`op://${name}-production/`,
		),
	);
};

// Writes the answers a rendered project keeps: CONTEXT.md terms, env files and .template.json.
export const answersWrite = ({
	answers,
	directory,
	terms,
}: {
	answers: TemplateAnswers & { release: string };
	directory: string;
	terms: GlossaryTerm[];
}): void => {
	const context = join(directory, "CONTEXT.md");
	writeFileSync(
		context,
		contextLanguageWrite(readFileSync(context, "utf8"), terms),
	);
	envFilesWrite(directory, answers.name);
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

export const pnpmRun = (directory: string, args: string[]): void => {
	run({ command: "pnpm", args, options: { cwd: directory, inherit: true } });
};

export const gitCommitAll = (directory: string, message: string): void => {
	if (!existsSync(join(directory, ".git"))) {
		run({
			command: "git",
			args: ["init", "--quiet", "--initial-branch=main"],
			options: {
				cwd: directory,
			},
		});
	}
	run({ command: "git", args: ["add", "--all"], options: { cwd: directory } });
	run({
		command: "git",
		args: ["commit", "--quiet", "--message", message],
		options: { cwd: directory },
	});
};

// The ruleset on the default branch: every required app-ci.yml job, as `ci / <job>`.
export const rulesetBodyCreate = () => ({
	conditions: { ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] } },
	enforcement: "active",
	name: "ci",
	rules: [
		{
			parameters: {
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
	process.env.INIT_CWD ?? process.cwd();

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
		`  2. a ruleset on the default branch requiring ${requiredJobs.map((job) => `ci / ${job}`).join(", ")}`,
		"  3. Dependabot alerts, then Dependabot security updates",
		`Inside ${directory}, \`pnpm -C ${monorepo} app-create --github-only\` does all three and runs CI once on main.`,
	].join("\n");

const nextSteps = (directory: string): string =>
	[
		`Next: cd ${directory} && pnpm dev`,
		"Then add your first Domain's term to CONTEXT.md and run `pnpm domain-create <name> --bare` (docs/agents/domain-create.md).",
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
			terms: [],
		});
		await npmVersionsWait({
			packages: baselinePackagesPinned(
				readFileSync(join(directory, "package.json"), "utf8"),
			),
		});
		// The template's lockfile drops our own packages, so this install adds them.
		pnpmRun(directory, ["install", "--no-frozen-lockfile"]);
		gitCommitAll(directory, `🎉 Create ${answers.name} from app@${release}`);
	} catch (error) {
		console.error(
			`app-create: stopped before creating the repository; ${directory} holds the partial render`,
		);
		throw error;
	}
	return directory;
};

// GitHub indexes a new repository's workflows a few seconds after the push, so a missing workflow
// or run is retried. A ci.yml without workflow_dispatch (a release before it had one) is not.
const ghRetry = async (args: string[]): Promise<string> => {
	for (let attempt = 1; ; attempt++) {
		try {
			return run({ command: "gh", args }).trim();
		} catch (error) {
			if (attempt === 10 || /workflow_dispatch/.test(String(error))) {
				throw error;
			}
			await setTimeout(3_000);
		}
	}
};

const ciDispatch = async (repository: string): Promise<string> => {
	const page = `https://github.com/${repository}/actions/workflows/ci.yml`;
	const since = new Date(Date.now() - 60_000).toISOString().slice(0, 19);
	try {
		await ghRetry([
			"workflow",
			"run",
			"ci.yml",
			"--repo",
			repository,
			"--ref",
			"main",
		]);
		const url = await ghRetry([
			"run",
			"list",
			"--repo",
			repository,
			"--workflow",
			"ci.yml",
			"--event",
			"workflow_dispatch",
			"--created",
			`>=${since}`,
			"--limit",
			"1",
			"--json",
			"url",
			"--jq",
			'.[0].url // error("no run yet")',
		]);
		return `CI is running on main: ${url}`;
	} catch {
		return `Could not start CI on main; run it from ${page}`;
	}
};

// owner/name from a git remote URL (https or ssh).
export const repositoryFromRemote = (url: string): string | null =>
	/github\.com[:/]([^/]+\/[^/]+?)(\.git)?\/?$/.exec(url.trim())?.[1] ?? null;

const originRead = (directory: string): string | null => {
	try {
		return repositoryFromRemote(
			run({
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
// uses that one. Then the ruleset unless one named ci exists, Dependabot, and one CI run on main.
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
			run({ command: "gh", args: ["api", "user", "--jq", ".login"] }).trim();
		repository = `${login}/${name}`;
		run({
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
	const rulesets = run({
		command: "gh",
		args: ["api", `repos/${repository}/rulesets`, "--jq", ".[].name"],
	});
	if (rulesets.split("\n").includes("ci")) {
		console.log(`${repository} already has the ci ruleset`);
	} else {
		run({
			command: "gh",
			args: [
				"api",
				"--method",
				"POST",
				`repos/${repository}/rulesets`,
				"--input",
				"-",
			],
			options: { input: JSON.stringify(rulesetBodyCreate()) },
		});
	}
	for (const args of securityUpdatesCalls(repository))
		run({ command: "gh", args });
	console.log(`Set up https://github.com/${repository}`);
	console.log(await ciDispatch(repository));
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
