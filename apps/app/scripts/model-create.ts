// pnpm model-create <context> <model> [--plural <p>] [--bare] [options]: copies Foo, the
// Template's Model, into an existing context under a new name, and wires it in at every
// `wiring:` marker, in the context's own files and in the entry points. --bare copies only
// Foo's core and the options named. Writes no migration and never commits. pnpm context-create makes
// the context first; `pnpm model-create --help` lists the options.
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { argsFail, argsParse, argsUsageFail } from "./args.ts";
import {
	type Piece,
	pieceBlocksRemove,
	pieceScheduleLines,
	piecesRemovedFind,
} from "./pieces.ts";
import { processRun } from "./process-run.ts";
import {
	appIsMonorepo,
	camelFromKebab,
	contextsPairsFind,
	filesRead,
	fooBlocksFind,
	fooPathRename,
	fooRename,
	lineIsFoo,
	linesBlocksFind,
	linesRemove,
	type NameForms,
	pascalFromKebab,
	type TemplateFile,
	templateFetch,
	templateJsonRead,
} from "./template-render.ts";

export const kebabPattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
// Where renamed lines go; contexts-start and contexts-end only delimit.
const markerPattern =
	/^\s*(\/\/|#) wiring: (?!contexts-(start|end)\s*$)[a-z-]+\s*$/;

// ---------------------------------------------------------------------------
// The Template's foo context: its context files, Foo's files, and Bar's

// The context's own files. context-create copies them without any Model's lines;
// model-create adds its Model's lines at their `wiring:` markers.
export const contextFilePaths = new Set(
	[
		"index.ts",
		"application/foo-use-cases.ts",
		"application/ports.ts",
		"domain/errors.ts",
		"domain/repositories.ts",
		"adapters/outbound/foo-ports.memory.ts",
		"adapters/outbound/foo-transaction.memory.ts",
		"adapters/outbound/foo-transaction.postgres.ts",
		"adapters/outbound/index-queue.test.ts",
		"adapters/outbound/index.ts",
	].map((path) => `src/contexts/foo/${path}`),
);

// Bar, foo's second Model, stays in the Template: neither command ever copies it.
const barPathIs = (path: string): boolean =>
	/^src\/contexts\/foo\/(.+\/)?bar[-.][^/]*$/.test(path) ||
	/^migrations\/[^/]*_foo_bar_[^/]*\//.test(path);
// A line naming Bar: its identifiers (barCreate, BarRepository, bars), its id prefix ("bar") and
// its files (./bar-routes.ts), not a word such as "bar:read" or a nav-bar.
export const lineIsBar = (line: string): boolean =>
	/\b(bar[A-Z]\w*|Bar[A-Za-z0-9]*|bars)\b|"bar"|\/bar[-.]/.test(line);

// A foo that names the context, not the Foo Model: its interface, ports, transaction, Use
// cases, ACLs and upstream, Schedules list and memory state, its Postgres schema, and the paths of its folder and its own files.
const contextFooPattern =
	/\b(foo|Foo)(?=(?:Context|ContextCreate|Ports|PortsCreate|PortsMemoryCreate|Upstream|TestUpstreamCreate|Schedules|Transaction|TransactionPorts|TransactionMemoryCreate|TransactionPostgresCreate|Clock|UseCases|UseCasesCreate|UseCasesContext|MemoryState|MemoryStateCreate|[A-Z][A-Za-z0-9]*(?:Acl(?:Create|Actor)?|Upstream))\b)|(?<=contexts\/)foo(?=\/)|(?<=pgSchema\(")foo(?=")|\bfoo(?=-(?:use-cases|ports\.memory|test-upstream|transaction\.(?:memory|postgres))\.ts\b|-[a-z0-9-]+-acl(?:\.test)?\.ts\b)/g;
const contextPlaceholder = (text: string): string =>
	text.replace(contextFooPattern, (foo) => (foo === "Foo" ? "Qqctx" : "qqctx"));

// A line that names the Foo Model, not only the context.
export const lineIsModel = (line: string): boolean =>
	lineIsFoo(contextPlaceholder(line));

// Renames foo for a Model in a context: the context's names where foo is the context, the
// Model's everywhere else.
export const contextModelRename = ({
	model,
	context,
	path,
	text,
}: {
	model: NameForms;
	context: NameForms;
	path: string;
	text: string;
}): string =>
	fooRename({
		names: context,
		path,
		text: fooRename({ names: model, path, text: contextPlaceholder(text) })
			.replaceAll("Qqctx", "Foo")
			.replaceAll("qqctx", "foo"),
	});

export const contextModelPathRename = ({
	model,
	context,
	path,
}: {
	model: NameForms;
	context: NameForms;
	path: string;
}): string =>
	fooPathRename(
		path.replace(/^src\/contexts\/foo\//, "src/contexts/qqctx/"),
		model,
	).replace(/^src\/contexts\/qqctx\//, `src/contexts/${context.kebab}/`);

// One import or re-export per name, so a line names one Model's or the context's only. Biome
// merges them back.
const importsExplode = (text: string): string =>
	text.replace(
		/^(import|export)(\s+type)?\s*\{([^}]*)\}\s*from\s*("[^"]+");/gm,
		// biome-ignore lint/complexity/useMaxParams: String.replace passes each match this way.
		(whole, keyword: string, type = "", names: string, from: string) => {
			const list = names
				.split(",")
				.map((name) => name.trim())
				.filter((name) => name !== "");
			return list.length < 2
				? whole
				: list
						.map((name) => `${keyword}${type} { ${name} } from ${from};`)
						.join("\n");
		},
	);

const markerCommentIs = (line: string): boolean =>
	/^\s*\/\/ (piece-(start|end):|wiring:|model-create-(start|end):|biome-ignore)/.test(
		line,
	);

// In a context file a block takes the comment lines just above it, and the piece or option block
// that holds nothing else.
const blocksGrow = (
	text: string,
	blocks: [number, number][],
): [number, number][] => {
	const lines = text.split("\n");
	const grown = blocks.map(([from, to]): [number, number] => {
		let start = from;
		let end = to;
		for (;;) {
			const above = lines[start - 1] ?? "";
			const pair = /^\s*\/\/ (piece|model-create)-start: (\S+)\s*$/.exec(above);
			if (/^\s*\/\//.test(above) && !markerCommentIs(above)) start--;
			else if (
				pair !== null &&
				new RegExp(`^\\s*// ${pair[1]}-end: ${pair[2]}\\s*$`).test(
					lines[end + 1] ?? "",
				)
			) {
				start--;
				end++;
			} else break;
		}
		return [start, end];
	});
	const joined: [number, number][] = [];
	for (const [start, end] of grown.sort((a, b) => a[0] - b[0])) {
		const last = joined.at(-1);
		if (last !== undefined && start <= last[1] + 1) {
			last[1] = Math.max(last[1], end);
		} else joined.push([start, end]);
	}
	return joined;
};

// The blocks of `text` whose lines `lineIs` picks; grown as blocksGrow says in a context file.
export const blocksOf = ({
	lineIs,
	path,
	text,
}: {
	lineIs: (line: string) => boolean;
	path: string;
	text: string;
}): [number, number][] => {
	const blocks = linesBlocksFind({ lineIs, path, text });
	return contextFilePaths.has(path) ? blocksGrow(text, blocks) : blocks;
};

// A template file without Bar: its files go, and its lines leave the files Foo shares with it.
export const barRemove = (files: TemplateFile[]): TemplateFile[] =>
	files
		.filter((file) => !barPathIs(file.path))
		.map((file) => {
			// Bar lives in src/; scripts and tests elsewhere may say bar for something else.
			if (
				!file.path.startsWith("src/") ||
				!file.text.split("\n").some(lineIsBar)
			) {
				return file;
			}
			const text = importsExplode(file.text);
			return {
				path: file.path,
				text: linesRemove(
					text,
					blocksOf({ lineIs: lineIsBar, path: file.path, text }),
				),
			};
		});

// ---------------------------------------------------------------------------
// Pieces and options

// Foo's own files and its pages, with their unit tests.
const copiedPaths = [
	/^src\/contexts\/foo\//,
	/^src\/ui\/routes\/foo-(list|detail)(\.test)?\.tsx?$/,
];
// home.tsx (the / redirect) and its test come back with the first Model that has pages,
// which it redirects to.
const homePaths = new Set([
	"src/ui/routes/home.tsx",
	"src/ui/routes/home.test.ts",
]);

// What each Piece of the stack (scripts/pieces.ts) owns in the Template's foo files: the files a
// new context or Model leaves out once the Piece is removed, and the env lines. A Piece's
// `piece-start:` blocks stay out of them too. A new Piece fails type-checking until it is listed.
const piecesTemplate: Record<Piece, { lines?: RegExp; paths: RegExp[] }> = {
	analytics: { paths: [/^src\/contexts\/foo\/.*-analytics\.test\.ts$/] },
	// Owns no context file; listed so its blocks stay out once it is removed.
	"api-reference": { paths: [] },
	cache: { paths: [/^src\/contexts\/foo\/.*-cache(d|\.test)?\.ts$/] },
	// Owns no context file.
	cli: { paths: [] },
	// Owns no context file; listed so its blocks stay out once it is removed.
	"error-tracking": { paths: [] },
	// Owns no context file; listed so its blocks stay out once it is removed.
	"feature-flags": { paths: [] },
	live: {
		paths: [/^src\/contexts\/foo\/.*-live(-routes)?(\.test)?\.ts$/],
	},
	queue: {
		// Env files carry no markers; this is the line pieces.ts drops from .env.schema.
		lines: pieceScheduleLines,
		paths: [
			/^src\/worker\.ts$/,
			/^src\/contexts\/foo\/adapters\/inbound\/foo-schedule(\.test)?\.ts$/,
			/^src\/contexts\/foo\/adapters\/outbound\/foo-transaction\.postgres\.test\.ts$/,
			/^src\/contexts\/foo\/.*-queue\.test\.ts$/,
		],
	},
	// Owns no context file (src/redis-open.ts is not a context's).
	redis: { paths: [] },
	// Owns no context file; modelChecksRun regenerates the SDK.
	sdk: { paths: [] },
	ui: { paths: [/^src\/ui\//] },
};

// The template as a Project that removed those pieces would have it.
export const templateWithoutPieces = (
	template: TemplateFile[],
	removed: Piece[],
): TemplateFile[] =>
	template
		.filter(
			(file) =>
				!removed.some((piece) =>
					piecesTemplate[piece].paths.some((r) => r.test(file.path)),
				),
		)
		.map((file) => ({
			path: file.path,
			text: removed.reduce((text, piece) => {
				const { lines } = piecesTemplate[piece];
				return pieceBlocksRemove(
					lines === undefined ? text : text.replace(lines, ""),
					piece,
				);
			}, file.text),
		}));

// The options --bare leaves out unless named. analytics, cache and live are pieces too, so foo marks
// their lines with piece blocks; schedule and seed mark theirs with model-create-start: <option> /
// model-create-end: <option> blocks. Each option is whole files plus those blocks, plus its lines at
// the wiring markers wiringOptionOf names. `piece` is the piece an option needs installed.
export const modelOptions = [
	"analytics",
	"cache",
	"live",
	"pages",
	"schedule",
	"seed",
] as const;
export type ModelOption = (typeof modelOptions)[number];

const optionPieces: Record<ModelOption, Piece | undefined> = {
	analytics: "analytics",
	cache: "cache",
	live: "live",
	pages: "ui",
	schedule: "queue",
	seed: undefined,
};

const optionPaths: Record<ModelOption, RegExp[]> = {
	analytics: [],
	cache: [],
	live: [],
	pages: [/^src\/ui\/routes\/(foo-(list|detail)|home)(\.test)?\.tsx?$/],
	schedule: [
		/^src\/contexts\/foo\/(adapters\/inbound\/foo-schedule|application\/foo-stale-archive)(\.test)?\.ts$/,
	],
	seed: [/^src\/contexts\/foo\/adapters\/inbound\/foo-seed(\.test)?\.ts$/],
};

// The option a wiring line belongs to, from the file and the marker below it.
export const wiringOptionOf = ({
	marker,
	path,
}: {
	marker: string;
	path: string;
}): ModelOption | undefined => {
	const name = /wiring: ([a-z-]+)/.exec(marker)?.[1];
	if (name === "schedules" || name === "schedule-definitions")
		return "schedule";
	if (name === "seeds" || (path === "src/seed.ts" && name === "scopes")) {
		return "seed";
	}
	if (path.startsWith("src/ui/")) return "pages";
	return undefined;
};

// Drops every block from a `model-create-start: <option>` line through its end line.
const optionBlocksRemove = (text: string, option: ModelOption): string =>
	text.replaceAll(
		new RegExp(
			`^[ \\t]*// model-create-start: ${option}\\n[\\s\\S]*?^[ \\t]*// model-create-end: ${option}\\n`,
			"gm",
		),
		"",
	);

// Foo's own files as a Model with only some options has them. The option markers never reach a
// Project: they are for model-create alone.
export const optionsApply = ({
	files,
	optionsLeftOut,
}: {
	files: TemplateFile[];
	optionsLeftOut: ModelOption[];
}): TemplateFile[] =>
	templateWithoutPieces(
		files.filter(
			(file) =>
				!optionsLeftOut.some((option) =>
					optionPaths[option].some((r) => r.test(file.path)),
				),
		),
		optionsLeftOut.flatMap((option) => {
			const piece = optionPieces[option];
			return piece === option ? [piece] : [];
		}),
	).map((file) => ({
		path: file.path,
		text: optionsLeftOut
			.reduce((text, option) => optionBlocksRemove(text, option), file.text)
			.replaceAll(/^[ \t]*\/\/ model-create-(start|end): [a-z-]+\n/gm, ""),
	}));

// ---------------------------------------------------------------------------
// Wiring

const importEnd = (lines: string[]): number => {
	let end = -1;
	for (let i = 0; i < lines.length; i++) {
		if (!/^import /.test(lines[i] ?? "")) continue;
		end = i;
		while (!/;\s*$/.test(lines[end] ?? "") && end < lines.length) end++;
	}
	return end;
};

const namedImports = /^import\s+(type\s+)?\{([^}]*)\}\s*from\s*("[^"]+");/gm;

// The option a contexts-start/contexts-end pair serves, from its file and its template lines: a pair
// whose lines only that option uses stays empty until a Model brings the option.
export const pairOptionOf = ({
	content,
	path,
}: {
	content: string;
	path: string;
}): ModelOption | undefined => {
	if (path.startsWith("src/ui/")) return "pages";
	// The Server's argument to uiLoadContextCreate.
	if (path === "src/server.ts" && content.trim() === "contexts,") {
		return "pages";
	}
	return undefined;
};

// The project's pairs beside the template's, foo's lines left out of the template's.
const pairsMatch = ({
	path,
	project,
	template,
}: {
	path: string;
	project: string;
	template: string;
}) => {
	const source = linesRemove(template, fooBlocksFind(template, path)).split(
		"\n",
	);
	const pairs = contextsPairsFind(project, path);
	const sourcePairs = contextsPairsFind(source.join("\n"), path);
	if (pairs.length !== sourcePairs.length) {
		throw new Error(
			`${path}: has ${pairs.length} contexts-start/contexts-end pairs, the template ${sourcePairs.length}`,
		);
	}
	return pairs.map(([start, end], k) => {
		const [from, to] = sourcePairs[k] ?? [0, 0];
		const lines = source.slice(from + 1, to);
		return {
			empty: end === start + 1,
			lines,
			option: pairOptionOf({ path, content: lines.join("\n") }),
			start,
		};
	});
};

// Which pairs a command fills: context-create the ones no option needs, model-create the ones
// its options need.
export type PairWanted = (option: ModelOption | undefined) => boolean;

// Whether this file has an empty pair the command fills.
export const fileHasEmptyFillablePair = ({
	pairWanted,
	path,
	project,
	template,
}: {
	pairWanted: PairWanted;
	path: string;
	project: string;
	template: string;
}): boolean =>
	pairsMatch({ path, project, template }).some(
		(pair) => pair.empty && pairWanted(pair.option),
	);

// Fills each empty contexts-start/contexts-end pair the command wants with the template's lines,
// foo's left out, and imports the template names the render's Biome pass dropped as unused.
export const contextsPairsFill = ({
	pairWanted,
	path,
	project,
	template,
}: {
	pairWanted: PairWanted;
	path: string;
	project: string;
	template: string;
}): string => {
	const lines = project.split("\n");
	const pairs = pairsMatch({ path, project, template });
	for (const pair of [...pairs].reverse()) {
		if (pair.empty && pairWanted(pair.option)) {
			lines.splice(pair.start + 1, 0, ...pair.lines);
		}
	}
	return importsMissingAdd({ project: lines.join("\n"), template });
};

// Imports every name the template's file imports and the project's does not, foo's aside, or
// only those `used` names: the unused-imports pass then drops the ones no line uses.
const importsMissingAdd = ({
	project,
	template,
	used,
}: {
	project: string;
	template: string;
	used?: string;
}): string => {
	const lines = project.split("\n");
	const imported = new Set(
		[...project.matchAll(namedImports)].flatMap((m) =>
			(m[2] ?? "").split(",").map((name) => name.trim().split(/\s+/).at(-1)),
		),
	);
	const missing = [...template.matchAll(namedImports)]
		.filter((m) => !lineIsFoo(m[0]))
		.flatMap(([, type = "", names = "", from]) =>
			names
				.split(",")
				.map((name) => name.trim())
				.filter((name) => {
					const local = name.split(/\s+/).at(-1) ?? "";
					return (
						local !== "" &&
						!imported.has(local) &&
						(used === undefined || new RegExp(`\\b${local}\\b`).test(used))
					);
				})
				.map((name) => `import ${type}{ ${name} } from ${from};`),
		);
	// A file whose imports all went (src/contexts.ts) gets them back above a blank line.
	const noImports = importEnd(lines) === -1 && missing.length > 0;
	lines.splice(importEnd(lines) + 1, 0, ...missing, ...(noImports ? [""] : []));
	return lines.join("\n");
};

// Text as Biome may reflow it: no whitespace, no trailing comma before a closing bracket.
const spaceless = (text: string): string =>
	text.replaceAll(/\s+/g, "").replaceAll(/,(?=[)\]}>])/g, "");
// Whether the project already holds the block whole: `orderUseCases,` is not in
// `suborderUseCases,`, and a trailing comma the block ends with may be gone before a bracket.
const blockPresentIs = ({
	block,
	project,
}: {
	block: string;
	project: string;
}): boolean => {
	const needle = spaceless(block).replace(/,$/, "");
	const haystack = spaceless(project);
	for (let at = haystack.indexOf(needle); at !== -1; ) {
		const before = haystack[at - 1] ?? "";
		const after = haystack[at + needle.length] ?? "";
		const word = /[\w$]/;
		if (
			!(word.test(before) && word.test(needle[0] ?? "")) &&
			!(word.test(after) && word.test(needle.at(-1) ?? ""))
		) {
			return true;
		}
		at = haystack.indexOf(needle, at + 1);
	}
	return false;
};

// Adds the renamed copy of each block `blockIs` picks in the template's version of a file to the
// project's version: above the marker below it, or after the imports for an import. In a shared
// file the marker must come right after the block (other foo lines aside); in a context file it is
// the next marker down. A block the project already has is not added again, and neither is a line
// at a marker of an option left out (its import stays for the unused-imports pass to drop).
export const wiringInsert = ({
	blockIs,
	optionsLeftOut,
	path,
	project,
	rename,
	template,
}: {
	blockIs: (line: string) => boolean;
	optionsLeftOut?: ModelOption[] | null;
	path: string;
	project: string;
	rename: (text: string) => string;
	template: string;
}): string => {
	const lines = project.split("\n");
	const exploded = importsExplode(template);
	const templateLines = exploded.split("\n");
	const blocks = blocksOf({ lineIs: blockIs, path, text: exploded });
	const skipped = [...blocks, ...fooBlocksFind(exploded, path)];
	const inSkipped = (k: number) => skipped.some(([s, e]) => k >= s && k <= e);
	const context = contextFilePaths.has(path);
	const imports: string[] = [];
	const inserted: string[] = [];
	for (const [start, end] of blocks) {
		const text = rename(templateLines.slice(start, end + 1).join("\n"));
		if (blockPresentIs({ block: text, project })) continue;
		inserted.push(text);
		if (/^import /.test(templateLines[start] ?? "")) {
			imports.push(text);
			continue;
		}
		let anchor = end + 1;
		while (
			anchor < templateLines.length &&
			(context
				? !markerPattern.test(templateLines[anchor] ?? "")
				: inSkipped(anchor))
		) {
			anchor++;
		}
		const marker = templateLines[anchor] ?? "";
		if (!markerPattern.test(marker)) {
			throw new Error(
				`${path}: the template's line ${start + 1} names foo but has no wiring marker below it`,
			);
		}
		const option = wiringOptionOf({ path, marker });
		if (option !== undefined && optionsLeftOut?.includes(option)) continue;
		const at = lines.findIndex((line) => line.trim() === marker.trim());
		if (at === -1) {
			throw new Error(
				`${path}: missing marker "${marker.trim()}"; put it back where the template has it`,
			);
		}
		lines.splice(at, 0, ...text.split("\n"));
	}
	if (imports.length > 0) {
		lines.splice(importEnd(lines) + 1, 0, ...imports.join("\n").split("\n"));
	}
	return importsMissingAdd({
		project: lines.join("\n"),
		template,
		used: inserted.join("\n"),
	});
};

// ---------------------------------------------------------------------------
// --reads: an anti-corruption layer (ACL) per upstream context, written in foo's names before the
// rename. The ACL belongs to the context, so context-create writes it; model-create passes the
// context's upstream to the ports calls in the Model's tests.

type Target = {
	camel: string;
	kebab: string;
	pascal: string;
	snake: string;
	words: string;
};

const targetNames = (kebab: string): Target => ({
	camel: camelFromKebab(kebab),
	kebab,
	pascal: pascalFromKebab(kebab),
	snake: kebab.replaceAll("-", "_"),
	words: kebab.replaceAll("-", " "),
});

const article = (words: string): string =>
	/^[aeiou]/.test(words) ? `an ${words}` : `a ${words}`;

// The ACL a context reads an upstream through: src/contexts/<context>/adapters/outbound/<context>-<upstream>-acl.ts.
export const aclPath = ({
	context,
	upstream,
}: {
	context: string;
	upstream: string;
}): string =>
	`src/contexts/${context}/adapters/outbound/${context}-${upstream}-acl.ts`;

// The reason a --reads target is refused, or undefined when it is fine.
export const readsRefusal = ({
	appDirectory,
	names,
	reads,
}: {
	appDirectory: string;
	names: NameForms;
	reads: string[];
}): string | undefined => {
	for (const kebab of reads) {
		if (!kebabPattern.test(kebab))
			return `--reads "${kebab}" is not kebab-case`;
		if (kebab === names.kebab) return `${kebab} cannot read itself`;
		// The Template's own context is renamed with the copy, so it cannot be a target.
		if (lineIsFoo(kebab))
			return `--reads ${kebab}: names foo, the Template's example name, which the render renames`;
		if (!existsSync(join(appDirectory, "src/contexts", kebab, "index.ts")))
			return `--reads ${kebab}: no src/contexts/${kebab}/`;
		if (
			existsSync(
				join(appDirectory, aclPath({ context: kebab, upstream: names.kebab })),
			)
		) {
			return `--reads ${kebab}: ${kebab} already reads ${names.kebab}; two contexts never read each other, so one reacts to the other's Domain events`;
		}
	}
	if (new Set(reads).size !== reads.length)
		return "--reads names a context twice";
	return undefined;
};

// Inserts before the anchor line, after it, or above the comment block that leads into it, so an
// anchor is code or a `// wiring:` marker and rewording a prose comment breaks nothing.
const linesAt = ({
	anchor,
	lines,
	path,
	text,
	where = "before",
}: {
	anchor: string;
	lines: string[];
	path: string;
	text: string;
	where?: "after" | "before" | "aboveComment";
}): string => {
	const all = text.split("\n");
	const found = all.indexOf(anchor);
	if (found === -1 || all.indexOf(anchor, found + 1) !== -1) {
		throw new Error(`${path}: --reads needs exactly one line "${anchor}"`);
	}
	let at = where === "after" ? found + 1 : found;
	while (where === "aboveComment" && /^\s*\/\//.test(all[at - 1] ?? "")) at--;
	all.splice(at, 0, ...lines);
	return all.join("\n");
};

const importsAfter = (text: string, imports: string[]): string => {
	const lines = text.split("\n");
	lines.splice(importEnd(lines) + 1, 0, ...imports);
	return lines.join("\n");
};

// The calls that build foo's ports or foo itself, which a context that reads needs its upstream
// for: fooPortsMemoryCreate() gets it as its argument, fooPortsCreate(connections) as its second,
// and fooContextCreate({ connections }) as a field.
const upstreamCallsExtend = (text: string): string => {
	let out = text;
	for (const call of [
		"fooPortsMemoryCreate(",
		"fooPortsCreate(",
		"fooContextCreate(",
	]) {
		let next = "";
		let from = 0;
		for (let at = out.indexOf(call); at !== -1; at = out.indexOf(call, from)) {
			// A call a comment names is no call.
			const lineStart = out.lastIndexOf("\n", at) + 1;
			if (out.slice(lineStart, at).trimStart().startsWith("//")) {
				next += out.slice(from, at + call.length);
				from = at + call.length;
				continue;
			}
			let depth = 1;
			let k = at + call.length;
			while (depth > 0 && k < out.length) {
				if (out[k] === "(") depth++;
				if (out[k] === ")") depth--;
				k++;
			}
			const inside = out.slice(at + call.length, k - 1).replace(/,\s*$/, "");
			const extended =
				call === "fooContextCreate("
					? inside.replace(/,?\s*\}\s*$/, ", upstream }")
					: inside.trim() === ""
						? "upstream"
						: `${inside}, upstream`;
			next += `${out.slice(from, at)}${call}${extended})`;
			from = k;
		}
		out = next + out.slice(from);
	}
	return out;
};

// A test that builds foo's ports or foo itself builds foo's upstream once, for real on memory.
// The file shares it: Foo's tests never write upstream rows, and a test that does builds its own.
const upstreamTestBuild = ({
	path,
	text,
}: {
	path: string;
	text: string;
}): string => {
	const helper = relative(
		dirname(path),
		"src/contexts/foo/adapters/outbound/foo-test-upstream.ts",
	);
	const specifier = helper.startsWith(".") ? helper : `./${helper}`;
	return linesAt({
		text: importsAfter(upstreamCallsExtend(text), [
			`import { fooTestUpstreamCreate } from "${specifier}";`,
		]),
		path,
		where: "after",
		anchor: `import { fooTestUpstreamCreate } from "${specifier}";`,
		lines: [
			"",
			"// The contexts this context reads, built for real on memory adapters.",
			"const upstream = await fooTestUpstreamCreate();",
		],
	});
};

const aclPort = (t: Target): string[] => [
	`// What the context reads about ${article(t.words)}, in its own terms: the anti-corruption layer in`,
	`// adapters/outbound/foo-${t.kebab}-acl.ts fills it from the ${t.words} context.`,
	`export type Foo${t.pascal}Acl = {`,
	`\tget(id: Id<"${t.snake}">): Promise<{ name: string } | undefined>;`,
	"};",
	"",
];

const acl = (t: Target): string =>
	`import type { Actor } from "@n8io/baseline-authn";
import type { ${t.pascal}Context } from "#contexts/${t.kebab}/index.ts";
import type { Foo${t.pascal}Acl } from "../../application/ports.ts";

// What the ACL uses of the ${t.words} context's interface.
export type Foo${t.pascal}Upstream = Pick<${t.pascal}Context, "useCases">;

// The ACL's own machine Actor: it only reads, so it holds no scope.
const foo${t.pascal}AclActor: Actor = {
	id: "foo-${t.kebab}-acl",
	kind: "client",
	scopes: [],
};

// Reads ${article(t.words)} through ${t.camel}Get and keeps only what foo needs of it.
export const foo${t.pascal}AclCreate = ({
	useCases,
}: Foo${t.pascal}Upstream): Foo${t.pascal}Acl => ({
	get: async (id) => {
		const r = await useCases.${t.camel}Get(foo${t.pascal}AclActor, {
			${t.camel}Id: id,
		});
		return r.ok ? { name: r.value.name } : undefined;
	},
});
`;

const aclTest = (t: Target): string =>
	`import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { describe, expect, it } from "vitest";
import { foo${t.pascal}AclCreate } from "./foo-${t.kebab}-acl.ts";
import { fooTestUpstreamCreate } from "./foo-test-upstream.ts";

const owner: Actor = { id: "owner", kind: "user", scopes: [] };

describe("foo${t.pascal}AclCreate", () => {
	it("reads ${article(t.words)}'s name through ${t.camel}Get", async () => {
		const { ${t.camel} } = await fooTestUpstreamCreate();
		const created = await ${t.camel}.useCases.${t.camel}Create(owner, { name: "Acme" });
		if (!created.ok) throw created.error;

		const acl = foo${t.pascal}AclCreate(${t.camel});

		expect(await acl.get(created.value.id)).toEqual({ name: "Acme" });
	});

	it("answers undefined for ${article(t.words)} that does not exist", async () => {
		const acl = foo${t.pascal}AclCreate((await fooTestUpstreamCreate()).${t.camel});

		expect(await acl.get(idCreate("${t.snake}"))).toBeUndefined();
	});
});
`;

const upstreamTest = (targets: Target[]): string =>
	`import { connectionsOpen } from "../../../../connections.ts";
import { contextsCreate } from "../../../../contexts.ts";
import type { FooUpstream } from "./index.ts";

// The contexts this context reads, built for real on memory adapters, for tests: no fake
// stands in for an upstream. Each call builds them afresh, with nothing in them.
export const fooTestUpstreamCreate = async (): Promise<FooUpstream> => {
	const contexts = contextsCreate(
		await connectionsOpen({
			role: "publisher",
			urls: { cache: "memory://", database: "memory://" },
		}),
	);
	return { ${targets.map((t) => `${t.camel}: contexts.${t.camel}Context`).join(", ")} };
};
`;

// Foo's files, and src/contexts.ts, as a foo that reads each target would have them: still in
// foo's names, so the rename that follows spells them for the new context.
export const readsApply = ({
	files,
	reads,
}: {
	files: TemplateFile[];
	reads: string[];
}): TemplateFile[] => {
	const targets = reads.map(targetNames);
	if (targets.length === 0) return files;
	const field = (t: Target) => `foo${t.pascal}Acl`;
	const changed = files.map(({ path, text }): TemplateFile => {
		switch (path) {
			case "src/contexts/foo/application/ports.ts": {
				const withTypes = linesAt({
					text,
					path,
					anchor: "export type FooPorts = {",
					lines: targets.flatMap(aclPort),
				});
				return {
					path,
					text: linesAt({
						text: withTypes,
						path,
						anchor: "\t// wiring: ports",
						where: "after",
						lines: targets.map((t) => `\t${field(t)}: Foo${t.pascal}Acl;`),
					}),
				};
			}
			case "src/contexts/foo/adapters/outbound/index.ts": {
				const typed = text
					.replace(
						"(connections: Connections): FooPorts =>",
						"(\n\tconnections: Connections,\n\tupstream: FooUpstream,\n): FooPorts =>",
					)
					.replace(
						"fooPortsMemoryCreate().ports",
						"fooPortsMemoryCreate(upstream).ports",
					);
				if (
					!typed.includes("upstream: FooUpstream") ||
					!typed.includes("fooPortsMemoryCreate(upstream).ports")
				) {
					throw new Error(
						`${path}: --reads cannot find fooPortsCreate's signature`,
					);
				}
				const imported = importsAfter(
					typed,
					targets.map(
						(t) =>
							`import { type Foo${t.pascal}Upstream, foo${t.pascal}AclCreate } from "./foo-${t.kebab}-acl.ts";`,
					),
				);
				const declared = linesAt({
					text: imported,
					path,
					anchor: "export const fooPortsCreate = (",
					where: "aboveComment",
					lines: [
						"// The contexts this context reads, built before it in src/contexts.ts: each fills its ACL.",
						`export type FooUpstream = { ${targets.map((t) => `${t.camel}: Foo${t.pascal}Upstream`).join("; ")} };`,
						"",
					],
				});
				return {
					path,
					text: linesAt({
						text: declared,
						path,
						anchor: "\t\t// wiring: ports",
						lines: targets.map(
							(t) =>
								`\t\t${field(t)}: foo${t.pascal}AclCreate(upstream.${t.camel}),`,
						),
					}),
				};
			}
			case "src/contexts/foo/adapters/outbound/foo-ports.memory.ts": {
				const taken = text.replace(
					"export const fooPortsMemoryCreate = () => {",
					"export const fooPortsMemoryCreate = (upstream: FooUpstream) => {",
				);
				if (taken === text) {
					throw new Error(
						`${path}: --reads cannot find the parameters of fooPortsMemoryCreate`,
					);
				}
				return {
					path,
					text: linesAt({
						text: importsAfter(taken, [
							'import type { FooUpstream } from "./index.ts";',
							...targets.map(
								(t) =>
									`import { foo${t.pascal}AclCreate } from "./foo-${t.kebab}-acl.ts";`,
							),
						]),
						path,
						anchor: "\t\t// wiring: ports",
						lines: targets.map(
							(t) =>
								`\t\t${field(t)}: foo${t.pascal}AclCreate(upstream.${t.camel}),`,
						),
					}),
				};
			}
			case "src/contexts/foo/index.ts": {
				const upstreamTaken = text
					.replace(
						"({\n\tconnections,\n}: {\n\tconnections: Connections;\n})",
						"({\n\tconnections,\n\tupstream,\n}: {\n\tconnections: Connections;\n\t// The contexts it reads, built before it: src/contexts.ts passes them.\n\tupstream: FooUpstream;\n})",
					)
					.replace(
						"fooPortsCreate(connections)",
						"fooPortsCreate(connections, upstream)",
					);
				if (!upstreamTaken.includes("upstream: FooUpstream")) {
					throw new Error(
						`${path}: --reads cannot find the parameters of fooContextCreate`,
					);
				}
				const imported = upstreamTaken.replace(
					'import { fooPortsCreate } from "./adapters/outbound/index.ts";',
					'import {\n\ttype FooUpstream,\n\tfooPortsCreate,\n} from "./adapters/outbound/index.ts";',
				);
				if (imported === upstreamTaken) {
					throw new Error(
						`${path}: --reads cannot find the import of fooPortsCreate`,
					);
				}
				return { path, text: imported };
			}
			case "src/contexts.ts": {
				const wired = text.replace(
					"fooContextCreate({ connections })",
					`fooContextCreate({\n\tconnections,\n\tupstream: { ${targets
						.map(
							(t) =>
								`// Built after ${t.words}: it reads ${t.words} through an ACL.\n${t.camel}: ${t.camel}Context`,
						)
						.join(",\n")} },\n})`,
				);
				if (wired === text) {
					throw new Error(
						`${path}: --reads cannot find the fooContextCreate({ connections }) call`,
					);
				}
				return { path, text: wired };
			}
			default:
				return path.endsWith(".test.ts") &&
					/\bfoo(PortsMemoryCreate|PortsCreate|ContextCreate)\(/.test(text)
					? { path, text: upstreamTestBuild({ path, text }) }
					: { path, text };
		}
	});
	return [
		...changed,
		{
			path: "src/contexts/foo/adapters/outbound/foo-test-upstream.ts",
			text: upstreamTest(targets),
		},
		...targets.flatMap((t) => [
			{
				path: `src/contexts/foo/adapters/outbound/foo-${t.kebab}-acl.ts`,
				text: acl(t),
			},
			{
				path: `src/contexts/foo/adapters/outbound/foo-${t.kebab}-acl.test.ts`,
				text: aclTest(t),
			},
		]),
	];
};

// ---------------------------------------------------------------------------
// Names

// The glossary term a name needs: invoice-line ↔ **Invoice line**:.
export const nameTerm = (kebab: string): string => {
	const words = kebab.replaceAll("-", " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
};

// The reason a Model name is refused for its form or for lacking an entry in its context's
// glossary, or undefined when it is fine.
export const nameRefusal = ({
	appDirectory,
	context,
	kebab,
}: {
	appDirectory: string;
	context: string;
	kebab: string;
}): string | undefined => {
	if (!kebabPattern.test(kebab)) return `"${kebab}" is not kebab-case`;
	if (lineIsFoo(kebab))
		return `"${kebab}" names foo, the Template's example name, which the render renames`;
	const term = nameTerm(kebab);
	const path = `src/contexts/${context}/CONTEXT.md`;
	const file = join(appDirectory, path);
	const glossary = existsSync(file) ? readFileSync(file, "utf8") : "";
	if (!glossary.toLowerCase().includes(`**${term.toLowerCase()}**:`)) {
		return `${path} has no **${term}**: entry; agree the term and add it first`;
	}
	return undefined;
};

// The reason model-create refuses this Model in this context, or undefined.
export const modelRefusal = ({
	model,
	appDirectory,
	context,
}: {
	model: NameForms;
	appDirectory: string;
	context: string;
}): string | undefined => {
	if (!kebabPattern.test(context)) return `"${context}" is not kebab-case`;
	if (!existsSync(join(appDirectory, "src/contexts", context, "index.ts"))) {
		return `no src/contexts/${context}/; make it with pnpm context-create ${context}`;
	}
	for (const name of [model.kebab, model.plural]) {
		if (!kebabPattern.test(name)) return `"${name}" is not kebab-case`;
	}
	// /api/v1/docs belongs to the API reference page and skips the sign-in guard.
	if (model.plural === "docs") {
		return '"docs" is the API reference page\'s path';
	}
	if (model.plural === model.kebab) {
		return "the plural must differ from the name";
	}
	// A Model's names (its routes, scopes, ids and Use cases) are the app's, not only its
	// context's: no other context may hold it, nor be named after it.
	const contexts = join(appDirectory, "src/contexts");
	for (const other of existsSync(contexts) ? readdirSync(contexts) : []) {
		const modelFile = `src/contexts/${other}/domain/${model.kebab}.ts`;
		if (existsSync(join(appDirectory, modelFile)))
			return `${modelFile} already exists`;
	}
	if (model.kebab !== context && existsSync(join(contexts, model.kebab))) {
		return `src/contexts/${model.kebab}/ is another context; name the Model otherwise`;
	}
	return nameRefusal({ appDirectory, context, kebab: model.kebab });
};

// The contexts a context already reads, from its ACL files: <context>-<upstream>-acl.ts.
export const contextReadsFind = ({
	appDirectory,
	context,
}: {
	appDirectory: string;
	context: string;
}): string[] => {
	const folder = join(
		appDirectory,
		"src/contexts",
		context,
		"adapters/outbound",
	);
	if (!existsSync(folder)) return [];
	return readdirSync(folder)
		.flatMap((name) => {
			const upstream = name.startsWith(`${context}-`)
				? /^(.+)-acl\.ts$/.exec(name.slice(context.length + 1))?.[1]
				: undefined;
			return upstream === undefined ? [] : [upstream];
		})
		.sort();
};

// ---------------------------------------------------------------------------
// Building the Model

// The files a new Model adds or changes in a context made with context-create, from the
// template's files and the project's. `options` null copies every option (no --bare).
// drizzle-kit refuses two exported schemas of one name, so only a context's first table exports
// its pgSchema; a later Model's table keeps its own copy unexported, as Bar's does.
const schemaExportDrop = ({
	appDirectory,
	file,
}: {
	appDirectory: string;
	file: TemplateFile;
}): TemplateFile => {
	const folder =
		/^(src\/contexts\/[^/]+\/adapters\/outbound)\/[^/]+-table\.ts$/.exec(
			file.path,
		)?.[1];
	const exported = /^export (const \w+ = pgSchema\()/m;
	if (folder === undefined || !existsSync(join(appDirectory, folder)))
		return file;
	const tables = readdirSync(join(appDirectory, folder)).filter((name) =>
		name.endsWith("-table.ts"),
	);
	return tables.some((name) =>
		exported.test(readFileSync(join(appDirectory, folder, name), "utf8")),
	)
		? { ...file, text: file.text.replace(exported, "$1") }
		: file;
};

export const modelFilesCreate = ({
	model,
	appDirectory,
	context,
	options = null,
	templateFull,
}: {
	model: NameForms;
	appDirectory: string;
	context: string;
	options?: ModelOption[] | null;
	templateFull: TemplateFile[];
}): TemplateFile[] => {
	const optionsLeftOut =
		options === null
			? []
			: modelOptions.filter((option) => !options.includes(option));
	const contextNames = { kebab: context, plural: `${context}s` };
	const template = barRemove(
		templateWithoutPieces(templateFull, piecesRemovedFind(appDirectory)),
	);
	// The first Model with pages fills the / route's pair in src/ui/routes.ts and brings
	// home.tsx back with it.
	const routes = join(appDirectory, "src/ui/routes.ts");
	const homeAdded =
		!optionsLeftOut.includes("pages") &&
		existsSync(routes) &&
		contextsPairsFind(readFileSync(routes, "utf8"), "src/ui/routes.ts").some(
			([start, end]) => end === start + 1,
		);
	// foo's CONTEXT.md is the context's own language, which context-create writes.
	const copied = (path: string) =>
		!contextFilePaths.has(path) &&
		!path.endsWith("/CONTEXT.md") &&
		(copiedPaths.some((p) => p.test(path)) ||
			(homeAdded && homePaths.has(path)));
	const foo = template.filter((f) => copied(f.path));
	// A context that reads others passes its upstream to the ports calls in Foo's tests.
	const read = readsApply({
		files: foo,
		reads: contextReadsFind({ appDirectory, context }),
	}).filter((f) => foo.some((g) => g.path === f.path));
	const own = optionsApply({ files: read, optionsLeftOut });
	const rename = (path: string) => (text: string) =>
		contextModelRename({ model, context: contextNames, path, text });
	const pathOf = (path: string) =>
		contextModelPathRename({ model, context: contextNames, path });
	// Checked before anything is built, so a refusal writes nothing.
	for (const file of own) {
		if (existsSync(join(appDirectory, pathOf(file.path)))) {
			throw new Error(
				`${pathOf(file.path)} already exists; move it aside first`,
			);
		}
	}
	const files: TemplateFile[] = own.map((file) => ({
		path: pathOf(file.path),
		text: rename(file.path)(file.text),
	}));
	for (const file of template) {
		const contextFile = contextFilePaths.has(file.path);
		// Markdown is never wired: a changelog or doc that quotes a marker on its own line
		// (CHANGELOG.md, which no Project has) must not become a target.
		if (
			copied(file.path) ||
			(file.path.startsWith("src/contexts/") && !contextFile) ||
			/^(scripts|test)\//.test(file.path) ||
			file.path.endsWith(".md") ||
			!file.text.split("\n").some((line) => markerPattern.test(line))
		) {
			continue;
		}
		const path = contextFile
			? fooPathRename(file.path, contextNames)
			: file.path;
		const target = join(appDirectory, path);
		if (!existsSync(target)) {
			throw new Error(`${path} is missing; the template wires Models there`);
		}
		const [source = file] = contextFile
			? optionsApply({ files: [file], optionsLeftOut })
			: [file];
		const project = readFileSync(target, "utf8");
		const pairWanted: PairWanted = (option) =>
			option === undefined || !optionsLeftOut.includes(option);
		files.push({
			path,
			text: wiringInsert({
				// A UI line naming only the context, such as its Use cases' key, comes with the
				// context's first Model with pages.
				blockIs: (line) =>
					lineIsModel(line) ||
					(file.path.startsWith("src/ui/") && lineIsFoo(line)),
				optionsLeftOut,
				path: file.path,
				project: fileHasEmptyFillablePair({
					pairWanted,
					path,
					project,
					template: source.text,
				})
					? contextsPairsFill({
							pairWanted,
							path,
							project,
							template: source.text,
						})
					: project,
				rename: rename(file.path),
				template: source.text,
			}),
		});
	}
	return files.map((file) => schemaExportDrop({ appDirectory, file }));
};

// Formats what context-create or model-create wrote. An option or piece left out leaves imports
// nothing uses, so an unused-imports pass goes first.
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
const modelMigrationHas = ({
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

const usage = `Usage: pnpm model-create <context> <model> [--plural <plural>] [--bare] [options]

Copies Foo, the Template's Model, into src/contexts/<context>/ as <model>, and wires it
into the context's files, the Server, the Worker and the UI. Make the context first with
pnpm context-create, and add <model>'s **Term**: entry to its CONTEXT.md.

  --plural <plural>  the plural, when it is not <model>s
  --bare             only the core: the Model, its errors, create/get/list/update/delete, the
                     API, the repository (memory, Postgres, contract test), created and deleted
                     Events. Without --bare every option below is copied.
  --analytics        with --bare: track the created Event
  --cache            with --bare: a read-through cache on get
  --live             with --bare: live updates to pages
  --pages            with --bare: list and detail pages
  --schedule         with --bare: the stale-archive Schedule and its Use case
  --seed             with --bare: development rows
  -h, --help         this help

Never generated: business model functions, Event handlers, sagas. See docs/agents/context-create.md.`;

const flags = {
	analytics: { type: "boolean" },
	bare: { type: "boolean" },
	cache: { type: "boolean" },
	live: { type: "boolean" },
	pages: { type: "boolean" },
	plural: { type: "string" },
	schedule: { type: "boolean" },
	seed: { type: "boolean" },
} as const;

const main = () => {
	const parsed = argsParse({ allowPositionals: true, options: flags, usage });
	if (parsed === undefined) return;
	const { positionals, values } = parsed;
	const [context, kebab] = positionals;
	if (
		context === undefined ||
		kebab === undefined ||
		positionals.length !== 2
	) {
		argsUsageFail(usage);
		return;
	}
	const named = modelOptions.filter((option) => values[option] === true);
	if (!values.bare && named.length > 0) {
		argsFail(
			"model-create",
			`--${named.join(", --")} picks options for --bare; without --bare every option is copied`,
		);
		return;
	}
	const options = values.bare ? named : null;
	const model: NameForms = {
		kebab,
		plural: values.plural ?? `${kebab}s`,
	};
	const appDirectory = process.cwd();
	const refusal =
		modelRefusal({ model, appDirectory, context }) ??
		modelOptionsRefusal({ appDirectory, options: named });
	if (refusal !== undefined) {
		argsFail("model-create", refusal);
		return;
	}
	let files: TemplateFile[] = [];
	try {
		files = modelFilesCreate({
			model,
			appDirectory,
			context,
			options,
			templateFull: templateOf(appDirectory),
		});
	} catch (error) {
		argsFail("model-create", (error as Error).message);
		return;
	}
	const wired = filesWriteAll({ appDirectory, files });
	console.log(
		`Wrote ${model.kebab} into src/contexts/${context}/ and wired it into ${wired} files; running pnpm check and pnpm test.`,
	);
	filesFormat({ appDirectory, paths: files.map((f) => f.path) });
	const checksFailure = modelChecksRun({
		appDirectory,
		command: "model-create",
	});
	if (checksFailure !== undefined) {
		console.error(checksFailure);
		process.exitCode = 1;
		return;
	}
	console.log(
		`Created ${model.kebab}; pnpm check and pnpm test pass.\n${modelNextStepsText(
			{
				model,
				context,
				migrated: modelMigrationHas({ model, appDirectory, context }),
				options: options ?? optionsAvailableFind(appDirectory),
			},
		)}`,
	);
};

if (import.meta.main) main();
