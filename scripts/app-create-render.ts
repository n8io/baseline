// Renders a release into a new directory, writes the Project's answers, installs and commits.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { npmTarballsWait } from "../apps/app/scripts/npm-tarballs-wait.ts";
import {
	type Piece,
	pieceIsKnown,
	pieces,
} from "../apps/app/scripts/pieces.ts";
import { processRun } from "../apps/app/scripts/process-run.ts";
import {
	filesWrite,
	releaseLatest,
	type TemplateAnswers,
	type TemplateFile,
	templateFetch,
	templateFinish,
} from "../apps/app/scripts/template-render.ts";
import { releaseRender } from "../apps/app/scripts/template-upgrade.ts";
import type { AppCreateArgs } from "./app-create-args.ts";
import { baselinePackagesPinned, npmVersionsWait } from "./app-create-npm.ts";
import { releaseWarningRead } from "./app-create-release.ts";

// The monorepo's apps/app, whose node_modules hold the Biome and varlock the render runs.
export const toolsDirectory = resolve(import.meta.dirname, "../apps/app");

// invoice-line ↔ **Invoice line**:, the glossary term context-create and model-create look for.
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

// The folder the person ran the command in: pnpm runs a script from the monorepo root.
export const directoryStart = (): string =>
	// biome-ignore lint/suspicious/noUndeclaredEnvVars: pnpm sets it; turbo never runs app-create
	process.env["INIT_CWD"] ?? process.cwd();

// The Pieces in an order piece-remove accepts: a Piece goes after the ones its `after` names
// (redis after cache and live, sdk after cli), whatever order they were asked for.
export const piecesRemovalOrder = (asked: string[]): string[] => {
	const ordered: string[] = [];
	let rest = asked.filter(pieceIsKnown);
	while (rest.length > 0) {
		const ready = rest.filter((name) =>
			(pieces[name as Piece].after ?? []).every(
				(later) => !rest.includes(later),
			),
		);
		// A cycle cannot happen (the removals are a fixed list); take the rest as given if it did.
		const next = ready.length > 0 ? ready : rest;
		ordered.push(...next);
		rest = rest.filter((name) => !next.includes(name));
	}
	return ordered;
};

const kebabPattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export const answersAsk = async (
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

export const projectRender = async (
	answers: TemplateAnswers,
	without: string[],
): Promise<string> => {
	const directory = resolve(directoryStart(), answers.name);
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
		// One at a time, each its own commit: piece-remove wants a clean tree, runs the Project's check
		// and undoes itself when it fails.
		for (const piece of piecesRemovalOrder(without)) {
			pnpmInheritRun(directory, ["piece-remove", piece]);
			gitCommitAll(directory, `➖ Remove ${piece}`);
		}
	} catch (error) {
		console.error(
			`app-create: stopped before creating the repository; ${directory} holds the partial render`,
		);
		throw error;
	}
	return directory;
};
