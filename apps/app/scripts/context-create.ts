// pnpm context-create <context> [--reads <context>]...: makes a bounded context with no Model
// yet: the context's own files from the Template's foo, renamed, without Foo's or Bar's lines, its
// CONTEXT.md and its wiring into the entry points. It refuses a context the map does not list. --reads adds an anti-corruption layer (ACL)
// over another context. pnpm model-create then adds its Models. Writes no migration and never commits.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { argsFail, argsParse, argsUsageFail } from "./args.ts";
import { contextMapRead } from "./glossary-check.ts";
import {
	barRemove,
	blocksOf,
	contextFilePaths,
	contextsPairsFill,
	fileHasEmptyFillablePair,
	filesFormat,
	filesWriteAll,
	kebabPattern,
	lineIsModel,
	modelOptions,
	nameTerm,
	optionsApply,
	type PairWanted,
	readsApply,
	readsRefusal,
	templateOf,
	templateWithoutPieces,
	wiringInsert,
} from "./model-create.ts";
import { piecesRemovedFind } from "./pieces.ts";
import {
	fooPathRename,
	fooRename,
	lineIsFoo,
	linesRemove,
	type TemplateFile,
} from "./template-render.ts";

// The context's row in CONTEXT-MAP.md, or undefined when the map lacks it or the file.
const contextMapRowFind = ({
	appDirectory,
	context,
}: {
	appDirectory: string;
	context: string;
}) => {
	const path = join(appDirectory, "CONTEXT-MAP.md");
	if (!existsSync(path)) return undefined;
	return contextMapRead(readFileSync(path, "utf8")).contexts.find(
		(c) => c.context === context,
	);
};

// The reason context-create refuses this name, or undefined.
export const contextRefusal = ({
	appDirectory,
	context,
}: {
	appDirectory: string;
	context: string;
}): string | undefined => {
	if (!kebabPattern.test(context)) return `"${context}" is not kebab-case`;
	if (lineIsFoo(context))
		return `"${context}" names foo, the Template's example name, which the render renames`;
	if (existsSync(join(appDirectory, "src/contexts", context))) {
		return `src/contexts/${context}/ already exists`;
	}
	if (contextMapRowFind({ appDirectory, context }) === undefined) {
		return `CONTEXT-MAP.md lists no ${context}; add its row under ## Contexts first`;
	}
	return undefined;
};

// The context's own glossary: a line to fill in, and an empty language that model-create
// needs each Model's term in.
export const contextGlossaryText = ({
	context,
}: {
	context: string;
}): string => `# ${nameTerm(context)}

What the ${context.replaceAll("-", " ")} context does and the Models it holds, in a sentence or two.

## Language
`;

// The files a new context adds or changes, from the template's files and the project's. `reads`
// names the contexts it reads through ACLs.
export const contextFilesCreate = ({
	appDirectory,
	context,
	reads: readsGiven,
	templateFull,
}: {
	appDirectory: string;
	context: string;
	reads?: string[] | null;
	templateFull: TemplateFile[];
}): TemplateFile[] => {
	const reads = readsGiven ?? [];
	const names = { kebab: context, plural: `${context}s` };
	const template = barRemove(
		templateWithoutPieces(templateFull, piecesRemovedFind(appDirectory)),
	);
	const read = readsApply({
		files: template.filter(
			(f) => contextFilePaths.has(f.path) || f.path === "src/contexts.ts",
		),
		reads,
	});
	const rename = (path: string) => (text: string) =>
		fooRename({ names, path, text });
	// The context's files lose every Model's lines and the option blocks that hold them.
	const own = read
		.filter((f) => f.path !== "src/contexts.ts")
		.map((file): TemplateFile => {
			const [shell = file] = contextFilePaths.has(file.path)
				? optionsApply({ files: [file], optionsLeftOut: [...modelOptions] })
				: [file];
			const text = contextFilePaths.has(file.path)
				? linesRemove(
						shell.text,
						blocksOf({
							lineIs: lineIsModel,
							path: file.path,
							text: shell.text,
						}),
					)
				: shell.text;
			return {
				path: fooPathRename(file.path, names),
				text: rename(file.path)(text),
			};
		});
	const files: TemplateFile[] = [
		...own,
		{
			path: `src/contexts/${context}/CONTEXT.md`,
			text: contextGlossaryText({ context }),
		},
	];
	// The entry points get the context's own lines; model-create brings the rest, the
	// UI's included.
	const pairWanted: PairWanted = (option) => option === undefined;
	for (const file of template) {
		if (
			/^(src\/contexts|src\/ui|scripts|test)\//.test(file.path) ||
			file.path.endsWith(".md") ||
			!file.text
				.split("\n")
				.some((line) => /^\s*(\/\/|#) wiring: [a-z-]+\s*$/.test(line))
		) {
			continue;
		}
		const source = read.find((f) => f.path === file.path)?.text ?? file.text;
		const target = join(appDirectory, file.path);
		if (!existsSync(target)) {
			throw new Error(
				`${file.path} is missing; the template wires contexts there`,
			);
		}
		const project = readFileSync(target, "utf8");
		const filled = fileHasEmptyFillablePair({
			pairWanted,
			path: file.path,
			project,
			template: source,
		})
			? contextsPairsFill({
					pairWanted,
					path: file.path,
					project,
					template: source,
				})
			: project;
		const text = wiringInsert({
			blockIs: (line) => lineIsFoo(line) && !lineIsModel(line),
			path: file.path,
			project: filled,
			rename: rename(file.path),
			template: source,
		});
		if (text !== project) files.push({ path: file.path, text });
	}
	return files;
};

// What to do after a context-create.
export const contextNextStepsText = ({
	context,
	reads,
}: {
	context: string;
	reads: string[];
}): string =>
	[
		"Next:",
		`  1. Say in src/contexts/${context}/CONTEXT.md what ${context} does, and add each Model's **Term**: under its ## Language.`,
		`  2. pnpm model-create ${context} <model> adds its first Model (often ${context} itself); pnpm check passes once it has one.`,
		...reads.map(
			(target, k) =>
				`  ${k + 3}. Read what ${context} needs from ${target} in src/contexts/${context}/adapters/outbound/${context}-${target}-acl.ts and its type in application/ports.ts, and add "| ${context} | ${target} | ACL |" under ## Relationships in CONTEXT-MAP.md.`,
		),
	].join("\n");

const usage = `Usage: pnpm context-create <context> [--reads <context>]...

Makes src/contexts/<context>/, a bounded context with no Model yet, from the Template's foo:
its interface, ports, transaction, Use cases and adapters' entries, its CONTEXT.md, and its
wiring into the entry points. Add <context>'s row to CONTEXT-MAP.md first, then add each
Model's term to its CONTEXT.md and the Model with pnpm model-create.

  --reads <context>  reads <context> through an anti-corruption layer:
                     adapters/outbound/<context>-<upstream>-acl.ts. Repeat it for more.
  -h, --help         this help

See docs/agents/context-create.md.`;

const options = {
	reads: { multiple: true, type: "string" },
} as const;

const main = () => {
	const parsed = argsParse({ allowPositionals: true, options, usage });
	if (parsed === undefined) return;
	const { positionals, values } = parsed;
	const [context] = positionals;
	if (context === undefined || positionals.length !== 1) {
		argsUsageFail(usage);
		return;
	}
	const reads = values.reads ?? [];
	const appDirectory = process.cwd();
	const refusal =
		contextRefusal({ appDirectory, context }) ??
		readsRefusal({
			appDirectory,
			names: { kebab: context, plural: `${context}s` },
			reads,
		});
	if (refusal !== undefined) {
		argsFail("context-create", refusal);
		return;
	}
	let files: TemplateFile[] = [];
	try {
		files = contextFilesCreate({
			appDirectory,
			context,
			reads,
			templateFull: templateOf(appDirectory),
		});
	} catch (error) {
		argsFail("context-create", (error as Error).message);
		return;
	}
	const wired = filesWriteAll({ appDirectory, files });
	filesFormat({
		appDirectory,
		paths: files.map((f) => f.path).filter((p) => !p.endsWith(".md")),
	});
	console.log(
		`Created src/contexts/${context}/ and wired it into ${wired} files.\n${contextNextStepsText({ context, reads })}`,
	);
};

if (import.meta.main) main();
