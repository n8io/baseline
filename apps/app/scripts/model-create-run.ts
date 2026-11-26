import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
	type ModelOption,
	modelOptions,
	optionPieces,
} from "./model-create-options.ts";
import { piecesRemovedFind } from "./pieces.ts";
import { processRun } from "./process-run.ts";
import {
	appIsMonorepo,
	filesRead,
	type NameForms,
	type TemplateFile,
	templateFetch,
	templateJsonRead,
} from "./template-render.ts";

export const filesFormat = ({
	appDirectory,
	paths,
}: {
	appDirectory: string;
	paths: string[];
}): void => {
	processRun({
		command: "pnpm",
		args: [
			"exec",
			"biome",
			"lint",
			"--write",
			"--unsafe",
			"--only=correctness/noUnusedImports",
			...paths,
		],
		options: { cwd: appDirectory },
	});
	processRun({
		command: "pnpm",
		args: ["exec", "biome", "check", "--write", ...paths],
		options: { cwd: appDirectory },
	});
};

// Writes the files and reports which existed already.
export const filesWriteAll = ({
	appDirectory,
	files,
}: {
	appDirectory: string;
	files: TemplateFile[];
}): number => {
	const wired = files.filter((f) => existsSync(join(appDirectory, f.path)));
	for (const file of files) {
		const target = join(appDirectory, file.path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, file.text);
	}
	return wired.length;
};

// The options this Project can have: those whose piece it has not removed.
export const optionsAvailableFind = (appDirectory: string): ModelOption[] => {
	const removed = piecesRemovedFind(appDirectory);
	return modelOptions.filter((option) => {
		const piece = optionPieces[option];
		return piece === undefined || !removed.includes(piece);
	});
};

// The refusal for options this Project cannot have, or undefined.
export const modelOptionsRefusal = ({
	appDirectory,
	options,
}: {
	appDirectory: string;
	options: ModelOption[];
}): string | undefined => {
	const available = optionsAvailableFind(appDirectory);
	const missing = options.find((option) => !available.includes(option));
	return missing === undefined
		? undefined
		: `--${missing} needs the ${optionPieces[missing]} piece, which this Project removed`;
};

// What to do after a model-create, for the options used.
export const modelNextStepsText = ({
	model,
	context,
	migrated,
	options,
}: {
	model: NameForms;
	context: string;
	// Whether a migration already creates the Model's table.
	migrated: boolean;
	options: ModelOption[] | null;
}): string => {
	const folder = `src/contexts/${context}`;
	const name = model.kebab;
	const has = (option: ModelOption) =>
		options === null || options.includes(option);
	const steps = [
		`Edit the Model in ${folder}/domain/${name}.ts and its table in ${folder}/adapters/outbound/${name}-table.ts; give it its own model functions there, and delete the Use cases and API operations it does not need.`,
		...(migrated
			? []
			: [
					`pnpm codegen --name ${name.replaceAll("-", "_")}_create writes its migration.`,
				]),
		...(has("schedule")
			? [
					`Change or delete the stale-archive Schedule in ${folder}/adapters/inbound/${name}-schedule.ts.`,
				]
			: []),
		...(has("seed")
			? [
					`Seed what development needs in ${folder}/adapters/inbound/${name}-seed.ts.`,
				]
			: []),
		...(has("pages")
			? [
					`Change the pages in src/ui/routes/${name}-list.tsx and ${name}-detail.tsx.`,
				]
			: []),
		"Business model functions, Event handlers and sagas are yours to write: docs/agents/context-create.md.",
	];
	return ["Next:", ...steps.map((step, k) => `  ${k + 1}. ${step}`)].join("\n");
};

// Whether a migration in migrations/ already creates the Model's table.
export const modelHasMigration = ({
	model,
	appDirectory,
	context,
}: {
	model: NameForms;
	appDirectory: string;
	context: string;
}): boolean => {
	const folder = join(appDirectory, "migrations");
	if (!existsSync(folder)) return false;
	const table = `CREATE TABLE "${context.replaceAll("-", "_")}"."${model.kebab.replaceAll("-", "_")}"`;
	return readdirSync(folder, { withFileTypes: true }).some(
		(d) =>
			d.isDirectory() &&
			existsSync(join(folder, d.name, "migration.sql")) &&
			readFileSync(join(folder, d.name, "migration.sql"), "utf8").includes(
				table,
			),
	);
};

// Runs pnpm check and pnpm test in the Project. When one fails it returns what to print, the
// output and a closing line; undefined when both pass.
export const modelChecksRun = ({
	appDirectory,
	command,
}: {
	appDirectory: string;
	command: string;
}): string | undefined => {
	try {
		// New routes make the committed SDK stale, and CI's check job fails on a stale SDK.
		const sdk = existsSync(join(appDirectory, "clients/sdk/package.json"));
		for (const script of [...(sdk ? ["sdk-generate"] : []), "check", "test"]) {
			processRun({
				command: "pnpm",
				args: ["run", script],
				options: { cwd: appDirectory },
			});
		}
	} catch (error) {
		const { message, stdout } = error as Error & { stdout?: string };
		return `${stdout ?? ""}${message}\n${command}: the new code does not pass check or unit tests yet`;
	}
	return undefined;
};

// The template the Project's files come from: this checkout in the monorepo, else its release.
export const templateOf = (appDirectory: string): TemplateFile[] =>
	appIsMonorepo(appDirectory)
		? filesRead(appDirectory)
		: templateFetch(templateJsonRead(appDirectory).release);
