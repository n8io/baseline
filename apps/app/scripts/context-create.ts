// pnpm context-create <context> [--reads <context>]...: makes a bounded context with no Aggregate
// yet: the context's own files from the Template's foo, renamed, without Foo's or Bar's lines, its
// CONTEXT.md with the subdomain type CONTEXT-MAP.md gives it, and its wiring into the composition
// roots. It refuses a context the map does not list. --reads adds an anti-corruption layer (ACL)
// over another context. pnpm aggregate-create then adds its Aggregates. Writes no migration and never commits.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
	aggregateLineIs,
	aggregateParts,
	barRemove,
	blocksOf,
	contextFilePaths,
	contextsPairsFill,
	filesFormat,
	filesWriteAll,
	kebabPattern,
	nameTerm,
	type PairWanted,
	pairsEmptyFillableHas,
	partsApply,
	piecesRemovedFind,
	readsApply,
	readsRefusal,
	templateOf,
	templateWithoutPieces,
	wiringInsert,
} from "./aggregate-create.ts";
import { contextMapRead } from "./glossary-check.ts";
import {
	fooLineIs,
	fooPathRename,
	fooRename,
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
	if (context.includes("foo")) return `"${context}" contains foo`;
	if (existsSync(join(appDirectory, "src/contexts", context))) {
		return `src/contexts/${context}/ already exists`;
	}
	if (contextMapRowFind({ appDirectory, context }) === undefined) {
		return `CONTEXT-MAP.md lists no ${context}; agree its subdomain type and add its row under ## Contexts first`;
	}
	return undefined;
};

// The context's own glossary: its subdomain type, a line to fill in, and an empty language that
// aggregate-create needs each Aggregate's term in.
export const contextGlossaryText = ({
	context,
	subdomain,
}: {
	context: string;
	subdomain: string;
}): string => `# ${nameTerm(context)}

Subdomain: ${subdomain}

What the ${context.replaceAll("-", " ")} context does and the Aggregates it holds, in a sentence or two.

## Language
`;

// The files a new context adds or changes, from the template's files and the project's. `reads`
// names the contexts it reads through ACLs.
export const contextFilesCreate = ({
	appDirectory,
	context,
	reads = [],
	templateFull,
}: {
	appDirectory: string;
	context: string;
	reads?: string[];
	templateFull: TemplateFile[];
}): TemplateFile[] => {
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
	// The context's files lose every Aggregate's lines and the part blocks that hold them.
	const own = read
		.filter((f) => f.path !== "src/contexts.ts")
		.map((file): TemplateFile => {
			const [shell = file] = contextFilePaths.has(file.path)
				? partsApply({ files: [file], partsLeftOut: [...aggregateParts] })
				: [file];
			const text = contextFilePaths.has(file.path)
				? linesRemove(
						shell.text,
						blocksOf({
							lineIs: aggregateLineIs,
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
			text: contextGlossaryText({
				context,
				// context-create refuses a context the map lacks; tests may skip the map.
				subdomain:
					contextMapRowFind({ appDirectory, context })?.subdomain ?? "core",
			}),
		},
	];
	// The composition roots get the context's own lines; aggregate-create brings the rest, the
	// UI's included.
	const pairWanted: PairWanted = (part) => part === undefined;
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
		const filled = pairsEmptyFillableHas({
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
			blockIs: (line) => fooLineIs(line) && !aggregateLineIs(line),
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
		`  1. Say in src/contexts/${context}/CONTEXT.md what ${context} does, and add each Aggregate's **Term**: under its ## Language.`,
		`  2. pnpm aggregate-create ${context} <aggregate> adds its first Aggregate (often ${context} itself); pnpm check passes once it has one.`,
		...reads.map(
			(target, k) =>
				`  ${k + 3}. Read what ${context} needs from ${target} in src/contexts/${context}/adapters/outbound/${context}-${target}-acl.ts and its type in application/ports.ts, and add "| ${context} | ${target} | ACL |" under ## Relationships in CONTEXT-MAP.md.`,
		),
	].join("\n");

const usage = `Usage: pnpm context-create <context> [--reads <context>]...

Makes src/contexts/<context>/, a bounded context with no Aggregate yet, from the Template's foo:
its interface, ports, transaction, Use cases and adapters' entries, its CONTEXT.md, and its
wiring into the composition roots. Add <context>'s row to CONTEXT-MAP.md first, then add each
Aggregate's term to its CONTEXT.md and the Aggregate with pnpm aggregate-create.

  --reads <context>  reads <context> through an anti-corruption layer:
                     adapters/outbound/<context>-<upstream>-acl.ts. Repeat it for more.
  -h, --help         this help

See docs/agents/context-create.md.`;

const fail = (message: string): never => {
	console.error(`context-create: ${message}`);
	process.exit(1);
};

const argsParse = () =>
	parseArgs({
		allowPositionals: true,
		options: {
			help: { short: "h", type: "boolean" },
			reads: { multiple: true, type: "string" },
		},
	});

const main = () => {
	let parsed: ReturnType<typeof argsParse>;
	try {
		parsed = argsParse();
	} catch (error) {
		console.error(`context-create: ${(error as Error).message}\n\n${usage}`);
		process.exit(1);
	}
	const { positionals, values } = parsed;
	if (values.help) {
		console.log(usage);
		return;
	}
	const [context] = positionals;
	if (context === undefined || positionals.length !== 1) {
		console.error(usage);
		process.exit(1);
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
	if (refusal !== undefined) fail(refusal);
	let files: TemplateFile[] = [];
	try {
		files = contextFilesCreate({
			appDirectory,
			context,
			reads,
			templateFull: templateOf(appDirectory),
		});
	} catch (error) {
		fail((error as Error).message);
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
