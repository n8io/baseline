// pnpm aggregate-create <context> <aggregate> [--plural <p>] [--bare] [parts]: copies Foo, the
// Template's Aggregate, into an existing context under a new name, and wires it in at every
// `wiring:` marker, in the context's own files and in the composition roots. --bare copies only
// Foo's core and the parts named. Writes no migration and never commits. pnpm context-create makes
// the context first; `pnpm aggregate-create --help` lists the parts.
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import {
	camelFromKebab,
	type DomainNames,
	domainsPairsFind,
	filesRead,
	fooBlocksFind,
	fooLineIs,
	fooPathRename,
	fooRename,
	linesBlocksFind,
	linesRemove,
	monorepoAppIs,
	pascalFromKebab,
	run,
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

// The context's own files. context-create copies them without any Aggregate's lines;
// aggregate-create adds its Aggregate's lines at their `wiring:` markers.
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

// Bar, foo's second Aggregate, stays in the Template: neither command ever copies it.
const barPathIs = (path: string): boolean =>
	/^src\/contexts\/foo\/(.+\/)?bar[-.][^/]*$/.test(path) ||
	/^migrations\/[^/]*_foo_bar_[^/]*\//.test(path);
// A line naming Bar: its identifiers (barCreate, BarRepository, bars), its id prefix ("bar") and
// its files (./bar-routes.ts), not a word such as "bar:read" or a nav-bar.
export const barLineIs = (line: string): boolean =>
	/\b(bar[A-Z]\w*|Bar[A-Za-z0-9]*|bars)\b|"bar"|\/bar[-.]/.test(line);

// A foo that names the context, not the Foo Aggregate: its interface, ports, transaction, Use
// cases, readers, Schedules list and memory state, its Postgres schema, and the paths of its folder and its own files.
const contextFooPattern =
	/\b(foo|Foo)(?=(?:Context|ContextCreate|Ports|PortsCreate|PortsMemoryCreate|Readers|Schedules|Transaction|TransactionPorts|TransactionMemoryCreate|TransactionPostgresCreate|Clock|UseCases|UseCasesCreate|UseCasesContext|MemoryState|MemoryStateCreate|[A-Z][A-Za-z0-9]*Reader(?:MemoryCreate|Create|Actor)?)\b)|(?<=contexts\/)foo(?=\/)|(?<=pgSchema\(")foo(?=")|(?<=bridges\/)foo(?=-)|\bfoo(?=-(?:use-cases|ports\.memory|transaction\.(?:memory|postgres))\.ts\b|-[a-z0-9-]+-reader(?:\.memory)?\.ts\b)/g;
const contextPlaceholder = (text: string): string =>
	text.replace(contextFooPattern, (foo) => (foo === "Foo" ? "Qqctx" : "qqctx"));

// A line that names the Foo Aggregate, not only the context.
export const aggregateLineIs = (line: string): boolean =>
	fooLineIs(contextPlaceholder(line));

// Renames foo for an Aggregate in a context: the context's names where foo is the context, the
// Aggregate's everywhere else.
export const contextAggregateRename = ({
	aggregate,
	context,
	path,
	text,
}: {
	aggregate: DomainNames;
	context: DomainNames;
	path: string;
	text: string;
}): string =>
	fooRename({
		names: context,
		path,
		text: fooRename({ names: aggregate, path, text: contextPlaceholder(text) })
			.replaceAll("Qqctx", "Foo")
			.replaceAll("qqctx", "foo"),
	});

export const contextAggregatePathRename = ({
	aggregate,
	context,
	path,
}: {
	aggregate: DomainNames;
	context: DomainNames;
	path: string;
}): string =>
	fooPathRename(
		path.replace(/^src\/contexts\/foo\//, "src/contexts/qqctx/"),
		aggregate,
	).replace(/^src\/contexts\/qqctx\//, `src/contexts/${context.kebab}/`);

// One import or re-export per name, so a line names one Aggregate's or the context's only. Biome
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
	/^\s*\/\/ (piece-(start|end):|wiring:|aggregate-create-(start|end):|biome-ignore)/.test(
		line,
	);

// In a context file a block takes the comment lines just above it, and the piece or part block
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
			const pair = /^\s*\/\/ (piece|aggregate-create)-start: (\S+)\s*$/.exec(
				above,
			);
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
				!file.text.split("\n").some(barLineIs)
			) {
				return file;
			}
			const text = importsExplode(file.text);
			return {
				path: file.path,
				text: linesRemove(
					text,
					blocksOf({ lineIs: barLineIs, path: file.path, text }),
				),
			};
		});

// ---------------------------------------------------------------------------
// Pieces and parts

// Foo's own files and its pages, with their unit tests.
const copiedPaths = [
	/^src\/contexts\/foo\//,
	/^src\/ui\/routes\/foo-(list|detail)(\.test)?\.tsx?$/,
];
// home.tsx (the / redirect) and its test come back with the first Aggregate that has pages,
// which it redirects to.
const homePaths = new Set([
	"src/ui/routes/home.tsx",
	"src/ui/routes/home.test.ts",
]);

// The pieces of the stack a Project may remove with pnpm piece-remove. A removed piece's
// package is gone from package.json; its files and its `piece-start:` blocks stay out of a new
// context or Aggregate.
const pieces = [
	{ name: "ui", package: "react-router", paths: [/^src\/ui\//] },
	{
		name: "analytics",
		package: "@n8io/baseline-analytics",
		paths: [/^src\/contexts\/foo\/.*-analytics\.test\.ts$/],
	},
	// Owns no context file; listed so its blocks stay out once it is removed.
	{
		name: "error-tracking",
		package: "@n8io/baseline-error-tracking",
		paths: [],
	},
	// Owns no context file either; listed for its server.ts block.
	{ name: "api-reference", package: "swagger-ui-dist", paths: [] },
	// Owns no context file either (src/redis-open.ts is not a context's).
	{ name: "redis", package: "@n8io/baseline-redis", paths: [] },
	// The SDK and the command line tool own no context file; checksRun regenerates the SDK. The
	// command line tool adds no package to the app, so its folder tells it is there.
	{ name: "sdk", package: "orval", paths: [] },
	{ folder: "clients/cli", name: "cli", paths: [] },
	{
		name: "live",
		package: "@n8io/baseline-live",
		paths: [/^src\/contexts\/foo\/.*-live(\.test)?\.ts$/],
	},
	{
		name: "cache",
		package: "@n8io/baseline-cache",
		paths: [/^src\/contexts\/foo\/.*-cache(d|\.test)?\.ts$/],
	},
	{
		name: "queue",
		package: "@n8io/baseline-queue",
		paths: [
			/^src\/worker\.ts$/,
			/^src\/contexts\/foo\/adapters\/inbound\/foo-schedule(\.test)?\.ts$/,
			/^src\/contexts\/foo\/adapters\/outbound\/foo-transaction\.postgres\.test\.ts$/,
			/^src\/contexts\/foo\/.*-queue\.test\.ts$/,
		],
		// Env files carry no markers; this is the line piece-remove.ts drops from .env.schema.
		lines:
			/^# schedule overrides.*\n((# @.*\n)?SCHEDULE_.*\n|# wiring: schedules\n)*/m,
	},
];

export const piecesRemovedFind = (appDirectory: string): string[] => {
	const manifest = JSON.parse(
		readFileSync(join(appDirectory, "package.json"), "utf8"),
	) as {
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
	};
	const installed = {
		...manifest.dependencies,
		...manifest.devDependencies,
	};
	return pieces
		.filter((p) =>
			p.package === undefined
				? !existsSync(join(appDirectory, p.folder ?? "", "package.json"))
				: !(p.package in installed),
		)
		.map((p) => p.name);
};

// Drops every block from a `piece-start: <name>` line through its `piece-end: <name>` line.
export const pieceBlocksRemove = (text: string, name: string): string =>
	text.replaceAll(
		new RegExp(
			`^[ \\t]*(//|#) piece-start: ${name}\\n[\\s\\S]*?^[ \\t]*(//|#) piece-end: ${name}\\n`,
			"gm",
		),
		"",
	);

// The template as a Project that removed those pieces would have it.
export const templateWithoutPieces = (
	template: TemplateFile[],
	removed: string[],
): TemplateFile[] =>
	template
		.filter(
			(file) =>
				!pieces.some(
					(p) =>
						removed.includes(p.name) && p.paths.some((r) => r.test(file.path)),
				),
		)
		.map((file) => ({
			path: file.path,
			text: pieces
				.filter((p) => removed.includes(p.name))
				.reduce(
					(text, p) =>
						pieceBlocksRemove(
							p.lines === undefined ? text : text.replace(p.lines, ""),
							p.name,
						),
					file.text,
				),
		}));

// The parts --bare leaves out unless named. analytics, cache and live are pieces too, so foo marks
// their lines with piece blocks; schedule and seed mark theirs with aggregate-create-start: <part> /
// aggregate-create-end: <part> blocks. Each part is whole files plus those blocks, plus its lines at
// the wiring markers wiringPartOf names. `piece` is the piece a part needs installed.
export const aggregateParts = [
	"analytics",
	"cache",
	"live",
	"pages",
	"schedule",
	"seed",
] as const;
export type AggregatePart = (typeof aggregateParts)[number];

const partPieces: Record<AggregatePart, string | undefined> = {
	analytics: "analytics",
	cache: "cache",
	live: "live",
	pages: "ui",
	schedule: "queue",
	seed: undefined,
};

const partPaths: Record<AggregatePart, RegExp[]> = {
	analytics: [],
	cache: [],
	live: [],
	pages: [/^src\/ui\/routes\/(foo-(list|detail)|home)(\.test)?\.tsx?$/],
	schedule: [
		/^src\/contexts\/foo\/(adapters\/inbound\/foo-schedule|application\/foo-stale-archive)(\.test)?\.ts$/,
	],
	seed: [/^src\/contexts\/foo\/adapters\/inbound\/foo-seed(\.test)?\.ts$/],
};

// The part a wiring line belongs to, from the file and the marker below it.
export const wiringPartOf = ({
	marker,
	path,
}: {
	marker: string;
	path: string;
}): AggregatePart | undefined => {
	const name = /wiring: ([a-z-]+)/.exec(marker)?.[1];
	if (name === "schedules" || name === "schedule-definitions")
		return "schedule";
	if (name === "seeds" || (path === "src/seed.ts" && name === "scopes")) {
		return "seed";
	}
	if (path.startsWith("src/ui/")) return "pages";
	return undefined;
};

// Drops every block from a `aggregate-create-start: <part>` line through its end line.
const partBlocksRemove = (text: string, part: AggregatePart): string =>
	text.replaceAll(
		new RegExp(
			`^[ \\t]*// aggregate-create-start: ${part}\\n[\\s\\S]*?^[ \\t]*// aggregate-create-end: ${part}\\n`,
			"gm",
		),
		"",
	);

// Foo's own files as an Aggregate with only some parts has them. The part markers never reach a
// Project: they are for aggregate-create alone.
export const partsApply = ({
	files,
	partsLeftOut,
}: {
	files: TemplateFile[];
	partsLeftOut: AggregatePart[];
}): TemplateFile[] =>
	templateWithoutPieces(
		files.filter(
			(file) =>
				!partsLeftOut.some((part) =>
					partPaths[part].some((r) => r.test(file.path)),
				),
		),
		partsLeftOut.filter((part) => partPieces[part] === part),
	).map((file) => ({
		path: file.path,
		text: partsLeftOut
			.reduce((text, part) => partBlocksRemove(text, part), file.text)
			.replaceAll(/^[ \t]*\/\/ aggregate-create-(start|end): [a-z-]+\n/gm, ""),
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

// The part a contexts-start/contexts-end pair serves, from its file and its template lines: a pair
// whose lines only that part uses stays empty until an Aggregate brings the part.
export const pairPartOf = ({
	content,
	path,
}: {
	content: string;
	path: string;
}): AggregatePart | undefined => {
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
	const pairs = domainsPairsFind(project, path);
	const sourcePairs = domainsPairsFind(source.join("\n"), path);
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
			part: pairPartOf({ path, content: lines.join("\n") }),
			start,
		};
	});
};

// Which pairs a command fills: context-create the ones no part needs, aggregate-create the ones
// its parts need.
export type PairWanted = (part: AggregatePart | undefined) => boolean;

// Whether this file has an empty pair the command fills.
export const pairsEmptyFillableHas = ({
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
		(pair) => pair.empty && pairWanted(pair.part),
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
		if (pair.empty && pairWanted(pair.part)) {
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
		.filter((m) => !fooLineIs(m[0]))
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
	// A file whose imports all went (src/use-cases.ts) gets them back above a blank line.
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
// at a marker of a part left out (its import stays for the unused-imports pass to drop).
export const wiringInsert = ({
	blockIs,
	partsLeftOut = [],
	path,
	project,
	rename,
	template,
}: {
	blockIs: (line: string) => boolean;
	partsLeftOut?: AggregatePart[];
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
		const part = wiringPartOf({ path, marker });
		if (part !== undefined && partsLeftOut.includes(part)) continue;
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
// --reads: a reader port, its memory fake and its Bridge, written in foo's names before the rename.
// The port belongs to the context, so context-create writes it; aggregate-create passes the
// context's readers to the fooPortsCreate calls in the Aggregate's tests.

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

// The reason a --reads target is refused, or undefined when it is fine.
export const readsRefusal = ({
	appDirectory,
	names,
	reads,
}: {
	appDirectory: string;
	names: DomainNames;
	reads: string[];
}): string | undefined => {
	for (const kebab of reads) {
		if (!kebabPattern.test(kebab))
			return `--reads "${kebab}" is not kebab-case`;
		if (kebab === names.kebab) return `${kebab} cannot read itself`;
		// The Template's own context is renamed with the copy, so it cannot be a target.
		if (kebab.includes("foo")) return `--reads ${kebab}: contains foo`;
		const ports = join(
			appDirectory,
			"src/contexts",
			kebab,
			"application/ports.ts",
		);
		if (!existsSync(ports))
			return `--reads ${kebab}: no src/contexts/${kebab}/`;
		const back = `${pascalFromKebab(kebab)}${pascalFromKebab(names.kebab)}Reader`;
		if (readFileSync(ports, "utf8").includes(back)) {
			return `--reads ${kebab}: ${kebab} already reads ${names.kebab}; two contexts never read each other, so one reacts to the other's Events`;
		}
	}
	if (new Set(reads).size !== reads.length)
		return "--reads names a context twice";
	return undefined;
};

// Inserts lines before (or after) the one line that is exactly `anchor`.
const linesAt = ({
	after = false,
	anchor,
	lines,
	path,
	text,
}: {
	after?: boolean;
	anchor: string;
	lines: string[];
	path: string;
	text: string;
}): string => {
	const all = text.split("\n");
	const at = all.indexOf(anchor);
	if (at === -1 || all.indexOf(anchor, at + 1) !== -1) {
		throw new Error(`${path}: --reads needs exactly one line "${anchor}"`);
	}
	all.splice(after ? at + 1 : at, 0, ...lines);
	return all.join("\n");
};

const importsAfter = (text: string, imports: string[]): string => {
	const lines = text.split("\n");
	lines.splice(importEnd(lines) + 1, 0, ...imports);
	return lines.join("\n");
};

// Adds `argument` as the last argument of every fooPortsCreate(...) call, and `names` to the
// import that brings fooPortsCreate in.
const portsCreateCallsExtend = ({
	argument,
	names,
	text,
}: {
	argument: string;
	names: string[];
	text: string;
}): string => {
	const call = "fooPortsCreate(";
	let out = "";
	let from = 0;
	for (let at = text.indexOf(call); at !== -1; at = text.indexOf(call, from)) {
		let depth = 1;
		let k = at + call.length;
		while (depth > 0 && k < text.length) {
			if (text[k] === "(") depth++;
			if (text[k] === ")") depth--;
			k++;
		}
		const inside = text.slice(at + call.length, k - 1).replace(/,\s*$/, "");
		out += `${text.slice(from, at)}${call}${inside}, ${argument})`;
		from = k;
	}
	out += text.slice(from);
	return names.length === 0
		? out
		: out.replace(
				/^import \{([^}]*\bfooPortsCreate\b[^}]*)\}/m,
				(_, list: string) =>
					`import { ${[list.trim().replace(/,$/, ""), ...names].join(", ")} }`,
			);
};

const readerPort = (t: Target): string[] => [
	`// What the context reads about ${article(t.words)}. The Bridge in`,
	`// src/bridges/foo-${t.kebab}-reader.ts fills it from the ${t.words} context.`,
	`export type Foo${t.pascal}Reader = {`,
	`\tget(id: Id<"${t.snake}">): Promise<{ name: string } | undefined>;`,
	"};",
	"",
];

const readerMemory = (t: Target): string =>
	`import type { Id } from "@n8io/baseline-id";
import type { Foo${t.pascal}Reader } from "../../application/ports.ts";

// The ${t.words} reader's fake for tests: it knows only the entries it is given.
export const foo${t.pascal}ReaderMemoryCreate = (
	entries: { id: Id<"${t.snake}">; name: string }[] = [],
): Foo${t.pascal}Reader => ({
	get: async (id) => {
		const entry = entries.find((e) => e.id === id);
		return entry === undefined ? undefined : { name: entry.name };
	},
});
`;

const bridge = (t: Target): string =>
	`import type { Actor } from "@n8io/baseline-authn";
import type { ${t.pascal}UseCases } from "#contexts/${t.kebab}/index.ts";
import type { Foo${t.pascal}Reader } from "#contexts/foo/index.ts";

// The Bridge's own machine Actor: it only reads, so it holds no scope.
const foo${t.pascal}ReaderActor: Actor = {
	id: "foo-${t.kebab}-reader",
	kind: "client",
	scopes: [],
};

// The only file that knows both contexts: foo reads ${article(t.words)} through ${t.camel}Get.
export const foo${t.pascal}ReaderCreate = (
	${t.camel}: Pick<${t.pascal}UseCases, "${t.camel}Get">,
): Foo${t.pascal}Reader => ({
	get: async (id) => {
		const r = await ${t.camel}.${t.camel}Get(foo${t.pascal}ReaderActor, {
			${t.camel}Id: id,
		});
		return r.ok ? { name: r.value.name } : undefined;
	},
});
`;

const bridgeTest = (t: Target): string =>
	`import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { describe, expect, it } from "vitest";
import { connectionsOpen } from "../connections.ts";
import { contextsCreate } from "../use-cases.ts";
import { foo${t.pascal}ReaderCreate } from "./foo-${t.kebab}-reader.ts";

const owner: Actor = { id: "owner", kind: "user", scopes: [] };
// Tests run on a memory database, so these are the ${t.words} context's memory ports.
const connections = await connectionsOpen({ role: "publisher" });

describe("foo${t.pascal}ReaderCreate", () => {
	it("reads ${article(t.words)}'s name through ${t.camel}Get", async () => {
		const ${t.camel} = contextsCreate(connections).${t.camel}Context.useCases;
		const created = await ${t.camel}.${t.camel}Create(owner, { name: "Acme" });
		if (!created.ok) throw created.error;

		const reader = foo${t.pascal}ReaderCreate(${t.camel});

		expect(await reader.get(created.value.id)).toEqual({ name: "Acme" });
	});

	it("answers undefined for ${article(t.words)} that does not exist", async () => {
		const ${t.camel} = contextsCreate(connections).${t.camel}Context.useCases;

		const reader = foo${t.pascal}ReaderCreate(${t.camel});

		expect(await reader.get(idCreate("${t.snake}"))).toBeUndefined();
	});
});
`;

// Foo's files, and src/use-cases.ts, as a foo that reads each target would have them: still in
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
	const field = (t: Target) => `foo${t.pascal}Reader`;
	const memoryName = (t: Target) => `foo${t.pascal}ReaderMemoryCreate`;
	const memoryPath = (t: Target) => `./foo-${t.kebab}-reader.memory.ts`;
	const readersMemory = `{ ${targets.map((t) => `${field(t)}: ${memoryName(t)}()`).join(", ")} }`;
	const changed = files.map(({ path, text }): TemplateFile => {
		switch (path) {
			case "src/contexts/foo/application/ports.ts": {
				const withTypes = linesAt({
					text,
					path,
					anchor: "export type FooPorts = {",
					lines: targets.flatMap(readerPort),
				});
				const withFields = linesAt({
					text: withTypes,
					path,
					anchor:
						"\t// Every Use case reads the time here, never from new Date().",
					lines: targets.map((t) => `\t${field(t)}: Foo${t.pascal}Reader;`),
				});
				const picked = targets.map((t) => `"${field(t)}"`).join(" | ");
				return {
					path,
					text: `${withFields.trimEnd()}\n\n// The ports Bridges fill: the second argument of fooPortsCreate.\nexport type FooReaders = Pick<FooPorts, ${picked}>;\n`,
				};
			}
			case "src/contexts/foo/adapters/outbound/index.ts": {
				const typed = text
					.replace(
						'import type { FooPorts } from "../../application/ports.ts";',
						'import type { FooPorts, FooReaders } from "../../application/ports.ts";',
					)
					.replace(
						"(connections: Connections): FooPorts =>",
						"(\n\tconnections: Connections,\n\treaders: FooReaders,\n): FooPorts =>",
					)
					.replace(
						'// "memory". Composition roots own every connection.',
						'// "memory". Composition roots own every connection. The readers come from Bridges, built in\n// src/use-cases.ts.',
					);
				if (!typed.includes("readers: FooReaders")) {
					throw new Error(
						`${path}: --reads cannot find fooPortsCreate's signature`,
					);
				}
				const exported = importsAfter(typed, [
					"",
					...targets.map(
						(t) => `export { ${memoryName(t)} } from "${memoryPath(t)}";`,
					),
				]);
				return {
					path,
					text: linesAt({
						text: exported,
						path,
						after: true,
						anchor: "\t\tfooClock: clockSystemCreate(),",
						lines: targets.map((t) => `\t\t${field(t)}: readers.${field(t)},`),
					}),
				};
			}
			case "src/contexts/foo/adapters/outbound/foo-ports.memory.ts":
				return {
					path,
					text: linesAt({
						text: importsAfter(
							text,
							targets.map(
								(t) => `import { ${memoryName(t)} } from "${memoryPath(t)}";`,
							),
						),
						path,
						after: true,
						anchor: "\t\tfooClock: clock,",
						lines: targets.flatMap((t) => [
							`\t\t// Knows no ${t.words}; a test that needs one passes a fake that does.`,
							`\t\t${field(t)}: ${memoryName(t)}(),`,
						]),
					}),
				};
			case "src/contexts/foo/index.ts": {
				const upstreamTaken = text
					.replace(
						"({\n\tconnections,\n}: {\n\tconnections: Connections;\n})",
						"({\n\tconnections,\n\tupstream,\n}: {\n\tconnections: Connections;\n\t// What the contexts it reads hand it, through their Bridges.\n\tupstream: FooReaders;\n})",
					)
					.replace(
						"fooPortsCreate(connections)",
						"fooPortsCreate(connections, upstream)",
					);
				if (!upstreamTaken.includes("upstream: FooReaders")) {
					throw new Error(
						`${path}: --reads cannot find the parameters of fooContextCreate`,
					);
				}
				// Each Bridge implements its reader, so the interface exports the reader types.
				return {
					path,
					text: linesAt({
						text: importsAfter(upstreamTaken, [
							'import type { FooReaders } from "./application/ports.ts";',
						]),
						path,
						anchor: "// wiring: exports",
						lines: [
							`export type { ${targets.map((t) => `Foo${t.pascal}Reader`).join(", ")} } from "./application/ports.ts";`,
						],
					}),
				};
			}
			case "src/use-cases.ts": {
				const bridged = text.replace(
					"fooContextCreate({ connections })",
					`fooContextCreate({\n\tconnections,\n\tupstream: { ${targets
						.map(
							(t) =>
								`// Built after ${t.words}: this Bridge reads its Use cases.\n${field(t)}: foo${t.pascal}ReaderCreate(${t.camel}Context.useCases)`,
						)
						.join(",\n")} },\n})`,
				);
				if (bridged === text) {
					throw new Error(
						`${path}: --reads cannot find the fooContextCreate({ connections }) call`,
					);
				}
				return {
					path,
					text: linesAt({
						text: bridged,
						path,
						after: true,
						anchor:
							'import { fooContextCreate } from "#contexts/foo/index.ts";',
						lines: targets.map(
							(t) =>
								`import { foo${t.pascal}ReaderCreate } from "#bridges/foo-${t.kebab}-reader.ts";`,
						),
					}),
				};
			}
			default:
				return text.includes("fooPortsCreate(")
					? {
							path,
							text: portsCreateCallsExtend({
								text,
								argument: readersMemory,
								names: targets.map(memoryName),
							}),
						}
					: { path, text };
		}
	});
	return [
		...changed,
		...targets.flatMap((t) => [
			{
				path: `src/contexts/foo/adapters/outbound/foo-${t.kebab}-reader.memory.ts`,
				text: readerMemory(t),
			},
			{ path: `src/bridges/foo-${t.kebab}-reader.ts`, text: bridge(t) },
			{
				path: `src/bridges/foo-${t.kebab}-reader.test.ts`,
				text: bridgeTest(t),
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

// The reason an Aggregate name is refused for its form or for lacking an entry in its context's
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
	if (kebab.includes("foo")) return `"${kebab}" contains foo`;
	const term = nameTerm(kebab);
	const path = `src/contexts/${context}/CONTEXT.md`;
	const file = join(appDirectory, path);
	const glossary = existsSync(file) ? readFileSync(file, "utf8") : "";
	if (!glossary.toLowerCase().includes(`**${term.toLowerCase()}**:`)) {
		return `${path} has no **${term}**: entry; agree the term and add it first`;
	}
	return undefined;
};

// The reason aggregate-create refuses this Aggregate in this context, or undefined.
export const aggregateRefusal = ({
	aggregate,
	appDirectory,
	context,
}: {
	aggregate: DomainNames;
	appDirectory: string;
	context: string;
}): string | undefined => {
	if (!kebabPattern.test(context)) return `"${context}" is not kebab-case`;
	if (!existsSync(join(appDirectory, "src/contexts", context, "index.ts"))) {
		return `no src/contexts/${context}/; make it with pnpm context-create ${context}`;
	}
	for (const name of [aggregate.kebab, aggregate.plural]) {
		if (!kebabPattern.test(name)) return `"${name}" is not kebab-case`;
	}
	// /api/v1/docs belongs to the API reference page and skips the sign-in guard.
	if (aggregate.plural === "docs") {
		return '"docs" is the API reference page\'s path';
	}
	if (aggregate.plural === aggregate.kebab) {
		return "the plural must differ from the name";
	}
	// An Aggregate's names (its routes, scopes, ids and Use cases) are the app's, not only its
	// context's: no other context may hold it, nor be named after it.
	const contexts = join(appDirectory, "src/contexts");
	for (const other of existsSync(contexts) ? readdirSync(contexts) : []) {
		const model = `src/contexts/${other}/domain/${aggregate.kebab}.ts`;
		if (existsSync(join(appDirectory, model))) return `${model} already exists`;
	}
	if (
		aggregate.kebab !== context &&
		existsSync(join(contexts, aggregate.kebab))
	) {
		return `src/contexts/${aggregate.kebab}/ is another context; name the Aggregate otherwise`;
	}
	return nameRefusal({ appDirectory, context, kebab: aggregate.kebab });
};

// The contexts a context already reads through Bridges, from the readers its ports.ts names.
export const contextReadsFind = ({
	appDirectory,
	context,
}: {
	appDirectory: string;
	context: string;
}): string[] => {
	const ports = join(
		appDirectory,
		"src/contexts",
		context,
		"application/ports.ts",
	);
	if (!existsSync(ports)) return [];
	const prefix = camelFromKebab(context);
	const picked =
		/export type \w+Readers = Pick<\s*\w+,\s*([^>]+)>/.exec(
			readFileSync(ports, "utf8"),
		)?.[1] ?? "";
	return [...picked.matchAll(/"(\w+)Reader"/g)].map(([, field = ""]) =>
		field
			.slice(prefix.length)
			.replace(/^[A-Z]/, (c) => c.toLowerCase())
			.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`),
	);
};

// ---------------------------------------------------------------------------
// Building the Aggregate

// The files a new Aggregate adds or changes in a context made with context-create, from the
// template's files and the project's. `parts` null copies every part (no --bare).
// drizzle-kit refuses two exported schemas of one name, so only a context's first table exports
// its pgSchema; a later Aggregate's table keeps its own copy unexported, as Bar's does.
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

export const aggregateFilesCreate = ({
	aggregate,
	appDirectory,
	context,
	parts = null,
	templateFull,
}: {
	aggregate: DomainNames;
	appDirectory: string;
	context: string;
	parts?: AggregatePart[] | null;
	templateFull: TemplateFile[];
}): TemplateFile[] => {
	const partsLeftOut =
		parts === null
			? []
			: aggregateParts.filter((part) => !parts.includes(part));
	const contextNames = { kebab: context, plural: `${context}s` };
	const template = barRemove(
		templateWithoutPieces(templateFull, piecesRemovedFind(appDirectory)),
	);
	// The first Aggregate with pages fills the / route's pair in src/ui/routes.ts and brings
	// home.tsx back with it.
	const routes = join(appDirectory, "src/ui/routes.ts");
	const homeAdded =
		!partsLeftOut.includes("pages") &&
		existsSync(routes) &&
		domainsPairsFind(readFileSync(routes, "utf8"), "src/ui/routes.ts").some(
			([start, end]) => end === start + 1,
		);
	// foo's CONTEXT.md is the context's own language, which context-create writes.
	const copied = (path: string) =>
		!contextFilePaths.has(path) &&
		!path.endsWith("/CONTEXT.md") &&
		(copiedPaths.some((p) => p.test(path)) ||
			(homeAdded && homePaths.has(path)));
	const foo = template.filter((f) => copied(f.path));
	// The context's readers reach the fooPortsCreate calls in Foo's tests.
	const read = readsApply({
		files: foo,
		reads: contextReadsFind({ appDirectory, context }),
	}).filter((f) => foo.some((g) => g.path === f.path));
	const own = partsApply({ files: read, partsLeftOut });
	const rename = (path: string) => (text: string) =>
		contextAggregateRename({ aggregate, context: contextNames, path, text });
	const pathOf = (path: string) =>
		contextAggregatePathRename({ aggregate, context: contextNames, path });
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
			throw new Error(
				`${path} is missing; the template wires Aggregates there`,
			);
		}
		const [source = file] = contextFile
			? partsApply({ files: [file], partsLeftOut })
			: [file];
		const project = readFileSync(target, "utf8");
		const pairWanted: PairWanted = (part) =>
			part === undefined || !partsLeftOut.includes(part);
		files.push({
			path,
			text: wiringInsert({
				// A UI line naming only the context, such as its Use cases' key, comes with the
				// context's first Aggregate with pages.
				blockIs: (line) =>
					aggregateLineIs(line) ||
					(file.path.startsWith("src/ui/") && fooLineIs(line)),
				partsLeftOut,
				path: file.path,
				project: pairsEmptyFillableHas({
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

// Formats what context-create or aggregate-create wrote. A part or piece left out leaves imports
// nothing uses, so an unused-imports pass goes first.
export const filesFormat = ({
	appDirectory,
	paths,
}: {
	appDirectory: string;
	paths: string[];
}): void => {
	run({
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
	run({
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

// The parts this Project can have: those whose piece it has not removed.
export const partsAvailableFind = (appDirectory: string): AggregatePart[] => {
	const removed = piecesRemovedFind(appDirectory);
	return aggregateParts.filter((part) => {
		const piece = partPieces[part];
		return piece === undefined || !removed.includes(piece);
	});
};

// The refusal for parts this Project cannot have, or undefined.
export const aggregatePartsRefusal = ({
	appDirectory,
	parts,
}: {
	appDirectory: string;
	parts: AggregatePart[];
}): string | undefined => {
	const available = partsAvailableFind(appDirectory);
	const missing = parts.find((part) => !available.includes(part));
	return missing === undefined
		? undefined
		: `--${missing} needs the ${partPieces[missing]} piece, which this Project removed`;
};

// What to do after an aggregate-create, for the parts used.
export const nextStepsText = ({
	aggregate,
	context,
	migrated,
	parts,
}: {
	aggregate: DomainNames;
	context: string;
	// Whether a migration already creates the Aggregate's table.
	migrated: boolean;
	parts: AggregatePart[] | null;
}): string => {
	const folder = `src/contexts/${context}`;
	const name = aggregate.kebab;
	const has = (part: AggregatePart) => parts === null || parts.includes(part);
	const steps = [
		`Edit the Aggregate in ${folder}/domain/${name}.ts and its table in ${folder}/adapters/outbound/${name}-table.ts; give it its own transitions and specifications there, and delete the Use cases and API operations it does not need.`,
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
		"Business transitions and specifications, Event handlers and outcome Events are yours to write: docs/agents/context-create.md.",
	];
	return ["Next:", ...steps.map((step, k) => `  ${k + 1}. ${step}`)].join("\n");
};

// Whether a migration in migrations/ already creates the Aggregate's table.
const aggregateMigrationHas = ({
	aggregate,
	appDirectory,
	context,
}: {
	aggregate: DomainNames;
	appDirectory: string;
	context: string;
}): boolean => {
	const folder = join(appDirectory, "migrations");
	if (!existsSync(folder)) return false;
	const table = `CREATE TABLE "${context.replaceAll("-", "_")}"."${aggregate.kebab.replaceAll("-", "_")}"`;
	return readdirSync(folder, { withFileTypes: true }).some(
		(d) =>
			d.isDirectory() &&
			existsSync(join(folder, d.name, "migration.sql")) &&
			readFileSync(join(folder, d.name, "migration.sql"), "utf8").includes(
				table,
			),
	);
};

// Runs pnpm check and pnpm test in the Project, or exits with their output.
export const checksRun = ({
	appDirectory,
	command,
}: {
	appDirectory: string;
	command: string;
}): void => {
	try {
		// New routes make the committed SDK stale, and CI's check job fails on a stale SDK.
		const sdk = existsSync(join(appDirectory, "clients/sdk/package.json"));
		for (const script of [...(sdk ? ["sdk-generate"] : []), "check", "test"]) {
			run({
				command: "pnpm",
				args: ["run", script],
				options: { cwd: appDirectory },
			});
		}
	} catch (error) {
		const { message, stdout } = error as Error & { stdout?: string };
		console.error(`${stdout ?? ""}${message}`);
		console.error(
			`${command}: the new code does not pass check or unit tests yet`,
		);
		process.exit(1);
	}
};

// The template the Project's files come from: this checkout in the monorepo, else its release.
export const templateOf = (appDirectory: string): TemplateFile[] =>
	monorepoAppIs(appDirectory)
		? filesRead(appDirectory)
		: templateFetch(templateJsonRead(appDirectory).release);

const usage = `Usage: pnpm aggregate-create <context> <aggregate> [--plural <plural>] [--bare] [parts]

Copies Foo, the Template's Aggregate, into src/contexts/<context>/ as <aggregate>, and wires it
into the context's files, the Server, the Worker and the UI. Make the context first with
pnpm context-create, and add <aggregate>'s **Term**: entry to its CONTEXT.md.

  --plural <plural>  the plural, when it is not <aggregate>s
  --bare             only the core: the Aggregate, its errors, create/get/list/update/delete, the
                     API, the repository (memory, Postgres, contract test), created and deleted
                     Events. Without --bare every part below is copied.
  --analytics        with --bare: track the created Event
  --cache            with --bare: a read-through cache on get
  --live             with --bare: live updates to pages
  --pages            with --bare: list and detail pages
  --schedule         with --bare: the stale-archive Schedule and its Use case
  --seed             with --bare: development rows
  -h, --help         this help

Never generated: business transitions, Event handlers, outcome Events. See docs/agents/context-create.md.`;

const fail = (message: string): never => {
	console.error(`aggregate-create: ${message}`);
	process.exit(1);
};

const argsParse = () =>
	parseArgs({
		allowPositionals: true,
		options: {
			analytics: { type: "boolean" },
			bare: { type: "boolean" },
			cache: { type: "boolean" },
			help: { short: "h", type: "boolean" },
			live: { type: "boolean" },
			pages: { type: "boolean" },
			plural: { type: "string" },
			schedule: { type: "boolean" },
			seed: { type: "boolean" },
		},
	});

const main = () => {
	let parsed: ReturnType<typeof argsParse>;
	try {
		parsed = argsParse();
	} catch (error) {
		console.error(`aggregate-create: ${(error as Error).message}\n\n${usage}`);
		process.exit(1);
	}
	const { positionals, values } = parsed;
	if (values.help) {
		console.log(usage);
		return;
	}
	const [context, kebab] = positionals;
	if (
		context === undefined ||
		kebab === undefined ||
		positionals.length !== 2
	) {
		console.error(usage);
		process.exit(1);
	}
	const named = aggregateParts.filter((part) => values[part] === true);
	if (!values.bare && named.length > 0) {
		fail(
			`--${named.join(", --")} picks parts for --bare; without --bare every part is copied`,
		);
	}
	const parts = values.bare ? named : null;
	const aggregate: DomainNames = {
		kebab,
		plural: values.plural ?? `${kebab}s`,
	};
	const appDirectory = process.cwd();
	const refusal =
		aggregateRefusal({ aggregate, appDirectory, context }) ??
		aggregatePartsRefusal({ appDirectory, parts: named });
	if (refusal !== undefined) fail(refusal);
	let files: TemplateFile[] = [];
	try {
		files = aggregateFilesCreate({
			aggregate,
			appDirectory,
			context,
			parts,
			templateFull: templateOf(appDirectory),
		});
	} catch (error) {
		fail((error as Error).message);
	}
	const wired = filesWriteAll({ appDirectory, files });
	console.log(
		`Wrote ${aggregate.kebab} into src/contexts/${context}/ and wired it into ${wired} files; running pnpm check and pnpm test.`,
	);
	filesFormat({ appDirectory, paths: files.map((f) => f.path) });
	checksRun({ appDirectory, command: "aggregate-create" });
	console.log(
		`Created ${aggregate.kebab}; pnpm check and pnpm test pass.\n${nextStepsText(
			{
				aggregate,
				context,
				migrated: aggregateMigrationHas({ aggregate, appDirectory, context }),
				parts: parts ?? partsAvailableFind(appDirectory),
			},
		)}`,
	);
};

if (import.meta.main) main();
