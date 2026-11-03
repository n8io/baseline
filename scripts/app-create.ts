// node scripts/app-create.ts: makes a new project repository from the latest app@ release.
// Renders apps/app, writes the project's answers, creates the first domain and its migration,
// then creates the private GitHub repository and the CI ruleset. Installs use NODE_AUTH_TOKEN or
// `gh auth token`; the end of the run lists the package settings pages that need the repo added.
// Flags skip the questions: --name --description --domain --plural --definition [--owner].
import { randomBytes } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import {
	filesWrite,
	releaseLatest,
	run,
	type TemplateAnswers,
	type TemplateFile,
	templateFetch,
	templateFinish,
} from "../apps/app/scripts/template-render.ts";
import { releaseRender } from "../apps/app/scripts/template-upgrade.ts";

export type GlossaryTerm = { term: string; definition: string };

export type AppCreateAnswers = TemplateAnswers & {
	owner: string;
	domain: { kebab: string; plural: string; definition: string };
};

// The app-ci.yml jobs a pull request must pass; glossary-check only warns.
export const requiredJobs = [
	"check",
	"unit",
	"integration",
	"migrations",
	"oasdiff",
	"image",
] as const;

// The monorepo's apps/app, whose node_modules hold the Biome and varlock the render runs.
export const toolsDirectory = resolve(import.meta.dirname, "../apps/app");

// invoice-line ↔ **Invoice line**:, the glossary term domain-create looks for.
export const glossaryTerm = (kebab: string): string => {
	const words = kebab.replaceAll("-", " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
};

// Renders a release's files with that release's own render code into a new directory.
export const appRender = async (
	directory: string,
	files: TemplateFile[],
	answers: TemplateAnswers,
): Promise<void> => {
	filesWrite(directory, await releaseRender(files, answers));
	templateFinish(directory, toolsDirectory);
};

// Puts the project's terms under CONTEXT.md's `## Language`, which the render leaves empty.
export const contextLanguageWrite = (text: string, terms: GlossaryTerm[]) => {
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
export const answersWrite = (
	directory: string,
	answers: TemplateAnswers & { repository: string; release: string },
	terms: GlossaryTerm[],
): void => {
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
				repository: answers.repository,
			},
			null,
			"\t",
		)}\n`,
	);
};

// The GitHub Packages token: NODE_AUTH_TOKEN in Actions, else the operator's `gh auth token`.
// undefined means pnpm falls back to the operator's own ~/.npmrc.
export const packagesToken = (): string | undefined => {
	const fromEnv = process.env.NODE_AUTH_TOKEN;
	if (fromEnv) return fromEnv;
	try {
		return run("gh", ["auth", "token"]).trim() || undefined;
	} catch {
		return undefined;
	}
};

// The @n8io/baseline-* packages a template depends on, from its package.json.
export const baselinePackages = (files: TemplateFile[]): string[] => {
	const manifest = files.find((f) => f.path === "package.json")?.text ?? "{}";
	const { dependencies = {}, devDependencies = {} } = JSON.parse(manifest) as {
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
	};
	return [
		...new Set(
			Object.keys({ ...dependencies, ...devDependencies }).filter((name) =>
				name.startsWith("@n8io/baseline-"),
			),
		),
	].sort();
};

// GitHub has no API to add a repo to a package, so each one is a click in the UI.
export const packageGrantLines = (
	repository: string,
	packages: string[],
): string[] => [
	`Add ${repository} with Read under Manage Actions access on each package:`,
	...packages.map(
		(name) =>
			`  https://github.com/users/n8io/packages/npm/${name.replace("@n8io/", "")}/settings`,
	),
];

// Runs pnpm with a userconfig holding the GitHub Packages token, as actions/setup-node writes
// it, and removes that file after. Without a token pnpm uses the operator's own ~/.npmrc.
export const pnpmWithToken = <T>(
	token: string | undefined,
	work: (pnpm: (directory: string, args: string[]) => void) => Promise<T>,
): Promise<T> => {
	if (token === undefined) {
		return work((directory, args) => {
			run("pnpm", args, { cwd: directory, inherit: true });
		});
	}
	const folder = mkdtempSync(join(tmpdir(), "app-create-npmrc-"));
	const userconfig = join(folder, ".npmrc");
	writeFileSync(
		userconfig,
		`@n8io:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=${token}\n`,
		{ mode: 0o600 },
	);
	const env = { ...process.env, NPM_CONFIG_USERCONFIG: userconfig };
	return work((directory, args) => {
		run("pnpm", args, { cwd: directory, env, inherit: true });
	}).finally(() => rmSync(folder, { force: true, recursive: true }));
};

export const gitCommitAll = (directory: string, message: string): void => {
	if (!existsSync(join(directory, ".git"))) {
		run("git", ["init", "--quiet", "--initial-branch=main"], {
			cwd: directory,
		});
	}
	run("git", ["add", "--all"], { cwd: directory });
	run("git", ["commit", "--quiet", "--message", message], { cwd: directory });
};

// The ruleset on the default branch: every required app-ci.yml job, as `ci / <job>`.
export const rulesetBody = () => ({
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

const kebabPattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

const answersAsk = async (): Promise<AppCreateAnswers> => {
	const { values } = parseArgs({
		options: {
			definition: { type: "string" },
			description: { type: "string" },
			domain: { type: "string" },
			name: { type: "string" },
			owner: { type: "string" },
			plural: { type: "string" },
		},
	});
	const prompt = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	const ask = async (given: string | undefined, question: string) =>
		given ?? (await prompt.question(`${question} `)).trim();
	try {
		const name = await ask(values.name, "Repository name (kebab-case):");
		const description = await ask(
			values.description,
			"One-line project description:",
		);
		const kebab = await ask(
			values.domain,
			"First domain, kebab-case singular (e.g. invoice-line):",
		);
		const plural =
			(await ask(values.plural, `Plural of ${kebab} [${kebab}s]:`)) ||
			`${kebab}s`;
		const definition = await ask(
			values.definition,
			`One-line definition of **${glossaryTerm(kebab)}**:`,
		);
		for (const [label, value] of [
			["name", name],
			["domain", kebab],
			["plural", plural],
		]) {
			if (!kebabPattern.test(value ?? "")) {
				throw new Error(`${label} "${value}" is not kebab-case`);
			}
		}
		if (description === "" || definition === "") {
			throw new Error("the description and the definition are required");
		}
		const owner =
			values.owner ?? run("gh", ["api", "user", "--jq", ".login"]).trim();
		return {
			description,
			domain: { definition, kebab, plural },
			name,
			owner,
		};
	} finally {
		prompt.close();
	}
};

const main = async () => {
	const answers = await answersAsk();
	const token = packagesToken();
	const directory = resolve(process.cwd(), answers.name);
	if (existsSync(directory)) throw new Error(`${directory} already exists`);
	const repository = `${answers.owner}/${answers.name}`;
	const release = releaseLatest();
	console.log(`Rendering app@${release} into ${directory}`);
	let files: TemplateFile[] = [];
	try {
		files = templateFetch(release);
		await appRender(directory, files, answers);
		answersWrite(directory, { ...answers, release, repository }, [
			{
				definition: answers.domain.definition,
				term: glossaryTerm(answers.domain.kebab),
			},
		]);
		await pnpmWithToken(token, async (pnpm) => {
			pnpm(directory, ["install"]);
			pnpm(directory, [
				"domain-create",
				answers.domain.kebab,
				"--plural",
				answers.domain.plural,
			]);
			pnpm(directory, ["codegen"]);
		});
		gitCommitAll(directory, `🎉 Create ${answers.name} from app@${release}`);
	} catch (error) {
		console.error(
			`app-create: stopped before creating the repository; ${directory} holds the partial render`,
		);
		throw error;
	}
	run(
		"gh",
		[
			"repo",
			"create",
			repository,
			"--private",
			"--description",
			answers.description,
			"--source",
			directory,
			"--remote",
			"origin",
			"--push",
		],
		{ inherit: true },
	);
	run(
		"gh",
		["api", "--method", "POST", `repos/${repository}/rulesets`, "--input", "-"],
		{ input: JSON.stringify(rulesetBody()) },
	);
	console.log(`Created https://github.com/${repository}`);
	console.log(
		packageGrantLines(repository, baselinePackages(files)).join("\n"),
	);
};

if (import.meta.main) {
	try {
		await main();
	} catch (error) {
		console.error(`app-create: ${(error as Error).message}`);
		process.exitCode = 1;
	}
}
