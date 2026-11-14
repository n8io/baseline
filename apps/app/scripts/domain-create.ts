// pnpm domain-create <name> [--plural <p>] [--bare] [parts] [--reads <domain>]...: copies the foo
// domain from the template release, renamed, and wires the copy in at every `domain-create:`
// marker. --bare copies only foo's core and the parts named; --reads adds a reader port and its
// Bridge. Writes no migration and never commits. `pnpm domain-create --help` lists the parts.
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
	linesRemove,
	monorepoAppIs,
	pascalFromKebab,
	run,
	type TemplateFile,
	templateFetch,
	templateJsonRead,
} from "./template-render.ts";

const kebabPattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
// Where foo's renamed lines go; domains-start and domains-end only delimit.
const markerPattern =
	/^\s*(\/\/|#) domain-create: (?!domains-(start|end)\s*$)[a-z-]+\s*$/;

// The domain, its pages and the pages' unit tests.
const copiedPaths = [
	/^src\/domains\/foo\//,
	/^src\/ui\/routes\/foo-(list|detail)(\.test)?\.tsx?$/,
];
// home.tsx (the / redirect) and its test come back with the first domain that has pages, which
// it redirects to.
const homePaths = new Set([
	"src/ui/routes/home.tsx",
	"src/ui/routes/home.test.ts",
]);

// The pieces of the stack a Project may remove with pnpm piece-remove. A removed piece's
// package is gone from package.json; its files and its `piece-start:` blocks stay out of a new
// domain.
const pieces = [
	{ name: "ui", package: "react-router", paths: [/^src\/ui\//] },
	{
		name: "analytics",
		package: "@n8io/baseline-analytics",
		paths: [/^src\/domains\/foo\/.*-analytics\.test\.ts$/],
	},
	// Owns no Domain file; listed so its blocks stay out once it is removed.
	{
		name: "error-tracking",
		package: "@n8io/baseline-error-tracking",
		paths: [],
	},
	{
		name: "live",
		package: "@n8io/baseline-live",
		paths: [/^src\/domains\/foo\/.*-live(\.test)?\.ts$/],
	},
	{
		name: "cache",
		package: "@n8io/baseline-cache",
		paths: [/^src\/domains\/foo\/.*-cache(d|\.test)?\.ts$/],
	},
	{
		name: "queue",
		package: "@n8io/baseline-queue",
		paths: [
			/^src\/worker\.ts$/,
			/^src\/domains\/foo\/api\/foo-schedule(\.test)?\.ts$/,
			/^src\/domains\/foo\/spi\/foo-transaction\.postgres\.test\.ts$/,
			/^src\/domains\/foo\/.*-queue\.test\.ts$/,
		],
		// Env files carry no markers; this is the line piece-remove.ts drops from .env.schema.
		lines:
			/^# schedule overrides.*\n((# @.*\n)?SCHEDULE_.*\n|# domain-create: schedules\n)*/m,
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
	return pieces.filter((p) => !(p.package in installed)).map((p) => p.name);
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
// their lines with piece blocks; schedule and seed mark theirs with domain-create-start: <part> /
// domain-create-end: <part> blocks. Each part is whole files plus those blocks, plus its lines at
// the wiring markers wiringPartOf names. `piece` is the piece a part needs installed.
export const domainParts = [
	"analytics",
	"cache",
	"live",
	"pages",
	"schedule",
	"seed",
] as const;
export type DomainPart = (typeof domainParts)[number];

const partPieces: Record<DomainPart, string | undefined> = {
	analytics: "analytics",
	cache: "cache",
	live: "live",
	pages: "ui",
	schedule: "queue",
	seed: undefined,
};

const partPaths: Record<DomainPart, RegExp[]> = {
	analytics: [],
	cache: [],
	live: [],
	pages: [/^src\/ui\/routes\/(foo-(list|detail)|home)(\.test)?\.tsx?$/],
	schedule: [
		/^src\/domains\/foo\/(api\/foo-schedule|use-cases\/foo-stale-archive|rules\/foo-stale-is)(\.test)?\.ts$/,
	],
	seed: [/^src\/domains\/foo\/api\/foo-seed(\.test)?\.ts$/],
};

// The part a wiring line belongs to, from the file and the marker below it.
export const wiringPartOf = ({
	marker,
	path,
}: {
	marker: string;
	path: string;
}): DomainPart | undefined => {
	const name = /domain-create: ([a-z-]+)/.exec(marker)?.[1];
	if (name === "schedules") return "schedule";
	if (path === "src/seed.ts" && (name === "seeds" || name === "scopes")) {
		return "seed";
	}
	if (path === "src/server.ts" && name === "live") return "live";
	if (path.startsWith("src/ui/")) return "pages";
	return undefined;
};

// Drops every block from a `domain-create-start: <part>` line through its end line.
const partBlocksRemove = (text: string, part: DomainPart): string =>
	text.replaceAll(
		new RegExp(
			`^[ \\t]*// domain-create-start: ${part}\\n[\\s\\S]*?^[ \\t]*// domain-create-end: ${part}\\n`,
			"gm",
		),
		"",
	);

// Foo's own files as a domain with only some parts has them. The part markers never reach a
// Project: they are for domain-create alone.
export const partsApply = ({
	files,
	partsLeftOut,
}: {
	files: TemplateFile[];
	partsLeftOut: DomainPart[];
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
			.replaceAll(/^[ \t]*\/\/ domain-create-(start|end): [a-z-]+\n/gm, ""),
	}));

// The glossary term a domain name needs: invoice-line ↔ **Invoice line**:.
export const domainTerm = (kebab: string): string => {
	const words = kebab.replaceAll("-", " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
};

// The reason a name is refused, or undefined when it is fine.
export const domainNameRefusal = (
	names: DomainNames,
	appDirectory: string,
): string | undefined => {
	for (const name of [names.kebab, names.plural]) {
		if (!kebabPattern.test(name)) return `"${name}" is not kebab-case`;
		if (name.includes("foo")) return `"${name}" contains foo`;
	}
	if (names.plural === names.kebab) {
		return "the plural must differ from the name";
	}
	if (existsSync(join(appDirectory, "src/domains", names.kebab))) {
		return `src/domains/${names.kebab}/ already exists`;
	}
	const term = domainTerm(names.kebab);
	const context = readFileSync(join(appDirectory, "CONTEXT.md"), "utf8");
	if (!context.toLowerCase().includes(`**${term.toLowerCase()}**:`)) {
		return `CONTEXT.md has no **${term}**: entry; agree the term and add it first`;
	}
	return undefined;
};

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

// The part a domains-start/domains-end pair serves, from its file and its template lines: a pair
// whose lines only that part uses stays empty until a domain brings the part.
export const pairPartOf = ({
	content,
	path,
}: {
	content: string;
	path: string;
}): DomainPart | undefined => {
	if (path === "src/seed.ts" || /\bseedsRun\b/.test(content)) return "seed";
	if (path.startsWith("src/ui/")) return "pages";
	// The Server's argument to uiLoadContextCreate.
	if (path === "src/server.ts" && content.trim() === "useCases,") {
		return "pages";
	}
	if (path === "src/worker.ts") return "schedule";
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
			`${path}: has ${pairs.length} domains-start/domains-end pairs, the template ${sourcePairs.length}`,
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

// Whether a domain with these parts fills an empty pair in this file that an earlier domain left
// empty (the first domain with pages fills the UI's).
export const pairsEmptyFillableHas = ({
	partsLeftOut,
	path,
	project,
	template,
}: {
	partsLeftOut: DomainPart[];
	path: string;
	project: string;
	template: string;
}): boolean =>
	pairsMatch({ path, project, template }).some(
		(pair) =>
			pair.empty &&
			pair.part !== undefined &&
			!partsLeftOut.includes(pair.part),
	);

// The first domain fills each emptied domains-start/domains-end pair with the template's lines,
// foo's left out, and imports the template names the render's Biome pass dropped as unused. A
// pair that serves a part the domain leaves out stays empty.
export const domainsPairsFill = ({
	partsLeftOut = [],
	path,
	project,
	template,
}: {
	partsLeftOut?: DomainPart[];
	path: string;
	project: string;
	template: string;
}): string => {
	const lines = project.split("\n");
	const pairs = pairsMatch({ path, project, template });
	for (const pair of [...pairs].reverse()) {
		const wanted = pair.part === undefined || !partsLeftOut.includes(pair.part);
		if (pair.empty && wanted) lines.splice(pair.start + 1, 0, ...pair.lines);
	}
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
				.filter(
					(name) => name !== "" && !imported.has(name.split(/\s+/).at(-1)),
				)
				.map((name) => `import ${type}{ ${name} } from ${from};`),
		);
	// A file whose imports all went (src/use-cases.ts) gets them back above a blank line.
	const noImports = importEnd(lines) === -1 && missing.length > 0;
	lines.splice(importEnd(lines) + 1, 0, ...missing, ...(noImports ? [""] : []));
	return lines.join("\n");
};

// Adds the renamed copy of each foo line in the template's version of a file to the project's
// version: above the same marker, or after the imports for an import.
// A line at a marker that belongs to a part this domain leaves out is not added; its import stays
// for the unused-imports pass to drop.
export const wiringInsert = ({
	names,
	pairsFill,
	partsLeftOut = [],
	path,
	project,
	template,
}: {
	names: DomainNames;
	// Fill each emptied domains-start/domains-end pair first (the first domain does).
	pairsFill: boolean;
	partsLeftOut?: DomainPart[];
	path: string;
	project: string;
	template: string;
}): string => {
	const lines = (
		pairsFill
			? domainsPairsFill({ project, template, path, partsLeftOut })
			: project
	).split("\n");
	const templateLines = template.split("\n");
	const blocks = fooBlocksFind(template, path);
	const inBlock = (k: number) => blocks.some(([s, e]) => k >= s && k <= e);
	const imports: string[] = [];
	for (const [start, end] of blocks) {
		const text = fooRename({
			text: templateLines.slice(start, end + 1).join("\n"),
			names,
			path,
		});
		if (/^import /.test(templateLines[start] ?? "")) {
			imports.push(text);
			continue;
		}
		let anchor = end + 1;
		while (inBlock(anchor)) anchor++;
		const marker = templateLines[anchor] ?? "";
		if (!markerPattern.test(marker)) {
			throw new Error(
				`${path}: the template's line ${start + 1} names foo but has no domain-create marker below it`,
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
	return lines.join("\n");
};

// ---------------------------------------------------------------------------
// --reads: a reader port, its memory fake and its Bridge, written in foo's names before the rename

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
export const domainReadsRefusal = ({
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
		// The Template's own Domain is renamed with the copy, so it cannot be a target.
		if (kebab.includes("foo")) return `--reads ${kebab}: contains foo`;
		const ports = join(appDirectory, "src/domains", kebab, "ports.ts");
		if (!existsSync(ports)) return `--reads ${kebab}: no src/domains/${kebab}/`;
		const back = `${pascalFromKebab(kebab)}${pascalFromKebab(names.kebab)}Reader`;
		if (readFileSync(ports, "utf8").includes(back)) {
			return `--reads ${kebab}: ${kebab} already reads ${names.kebab}; two Domains never read each other, so one reacts to the other's Events`;
		}
	}
	if (new Set(reads).size !== reads.length)
		return "--reads names a domain twice";
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
	`// What foos read about ${article(t.words)}. The Bridge in`,
	`// src/bridges/foo-${t.kebab}-reader.ts fills it from the ${t.words} Domain.`,
	`export type Foo${t.pascal}Reader = {`,
	`\tget(id: Id<"${t.snake}">): Promise<{ name: string } | undefined>;`,
	"};",
	"",
];

const readerMemory = (t: Target): string =>
	`import type { Id } from "@n8io/baseline-id";
import type { Foo${t.pascal}Reader } from "../ports.ts";

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
import type { ${t.pascal}UseCases } from "#domains/${t.kebab}/index.ts";
import type { Foo${t.pascal}Reader } from "#domains/foo/index.ts";

// The Bridge's own machine Actor: it only reads, so it holds no scope.
const foo${t.pascal}ReaderActor: Actor = {
	id: "foo-${t.kebab}-reader",
	kind: "client",
	scopes: [],
};

// The only file that knows both Domains: foos read ${article(t.words)} through ${t.camel}Get.
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
import { domainsUseCasesCreate } from "../use-cases.ts";
import { foo${t.pascal}ReaderCreate } from "./foo-${t.kebab}-reader.ts";

const owner: Actor = { id: "owner", kind: "user", scopes: [] };
// Tests run on a memory database, so these are the ${t.words} Domain's memory ports.
const connections = await connectionsOpen({ role: "publisher" });

describe("foo${t.pascal}ReaderCreate", () => {
	it("reads ${article(t.words)}'s name through ${t.camel}Get", async () => {
		const ${t.camel} = domainsUseCasesCreate(connections).${t.camel}UseCases;
		const created = await ${t.camel}.${t.camel}Create(owner, { name: "Acme" });
		if (!created.ok) throw created.error;

		const reader = foo${t.pascal}ReaderCreate(${t.camel});

		expect(await reader.get(created.value.id)).toEqual({ name: "Acme" });
	});

	it("answers undefined for ${article(t.words)} that does not exist", async () => {
		const ${t.camel} = domainsUseCasesCreate(connections).${t.camel}UseCases;

		const reader = foo${t.pascal}ReaderCreate(${t.camel});

		expect(await reader.get(idCreate("${t.snake}"))).toBeUndefined();
	});
});
`;

// Foo's files, and src/use-cases.ts, as a foo that reads each target would have them: still in
// foo's names, so the rename that follows spells them for the new domain.
export const domainReadsApply = ({
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
			case "src/domains/foo/ports.ts": {
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
			case "src/domains/foo/spi/index.ts": {
				const typed = text
					.replace(
						'import type { FooPorts } from "../ports.ts";',
						'import type { FooPorts, FooReaders } from "../ports.ts";',
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
			case "src/domains/foo/spi/foo-ports.memory.ts":
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
			case "src/use-cases.ts": {
				const bridged = portsCreateCallsExtend({
					text,
					names: [],
					argument: `{ ${targets
						.map(
							(t) =>
								`// Built after ${t.words}: this Bridge reads its Use cases.\n${field(t)}: foo${t.pascal}ReaderCreate(${t.camel}UseCases)`,
						)
						.join(",\n")} }`,
				});
				return {
					path,
					text: linesAt({
						text: bridged,
						path,
						after: true,
						anchor:
							'import { fooPortsCreate } from "#domains/foo/spi/index.ts";',
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
				path: `src/domains/foo/spi/foo-${t.kebab}-reader.memory.ts`,
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
// Building the domain

// The files a new domain adds or changes, from the template's files and the project's. `parts`
// null copies every part (no --bare); `reads` names the domains it reads through Bridges.
export const domainFilesCreate = ({
	appDirectory,
	names,
	parts = null,
	reads = [],
	templateFull,
}: {
	appDirectory: string;
	names: DomainNames;
	parts?: DomainPart[] | null;
	reads?: string[];
	templateFull: TemplateFile[];
}): TemplateFile[] => {
	const partsLeftOut =
		parts === null ? [] : domainParts.filter((part) => !parts.includes(part));
	const template = templateWithoutPieces(
		templateFull,
		piecesRemovedFind(appDirectory),
	);
	const domains = join(appDirectory, "src/domains");
	const firstDomain =
		!existsSync(domains) ||
		readdirSync(domains, { withFileTypes: true }).every(
			(d) => !d.isDirectory(),
		);
	// The first domain with pages fills the / route's pair in src/ui/routes.ts and brings
	// home.tsx back with it.
	const routes = join(appDirectory, "src/ui/routes.ts");
	const homeAdded =
		!partsLeftOut.includes("pages") &&
		existsSync(routes) &&
		domainsPairsFind(readFileSync(routes, "utf8"), "src/ui/routes.ts").some(
			([start, end]) => end === start + 1,
		);
	const copied = (path: string) =>
		copiedPaths.some((p) => p.test(path)) || (homeAdded && homePaths.has(path));
	const foo = domainReadsApply({
		files: template.filter(
			(f) => copied(f.path) || f.path === "src/use-cases.ts",
		),
		reads,
	});
	const own = partsApply({
		files: foo.filter((f) => f.path !== "src/use-cases.ts"),
		partsLeftOut,
	});
	const wiring = template.map(
		(file) => foo.find((f) => f.path === file.path) ?? file,
	);
	// Checked before anything is built, so a refusal writes nothing.
	for (const file of own) {
		const path = fooPathRename(file.path, names);
		if (existsSync(join(appDirectory, path))) {
			throw new Error(`${path} already exists; move it aside first`);
		}
	}
	const files: TemplateFile[] = own.map((file) => ({
		path: fooPathRename(file.path, names),
		text: fooRename({ text: file.text, names, path: file.path }),
	}));
	for (const file of wiring) {
		if (
			copied(file.path) ||
			/^(scripts|test)\//.test(file.path) ||
			!file.text.split("\n").some((line) => markerPattern.test(line))
		) {
			continue;
		}
		const target = join(appDirectory, file.path);
		if (!existsSync(target)) {
			throw new Error(
				`${file.path} is missing; the template wires domains there`,
			);
		}
		const project = readFileSync(target, "utf8");
		files.push({
			path: file.path,
			text: wiringInsert({
				project,
				template: file.text,
				path: file.path,
				names,
				pairsFill:
					firstDomain ||
					pairsEmptyFillableHas({
						partsLeftOut,
						path: file.path,
						project,
						template: file.text,
					}),
				partsLeftOut,
			}),
		});
	}
	return files;
};

// Formats what domain-create wrote. A part or piece left out leaves imports nothing uses, so an
// unused-imports pass goes first.
export const domainFilesFormat = ({
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

// The parts this Project can have: those whose piece it has not removed.
export const partsAvailableFind = (appDirectory: string): DomainPart[] => {
	const removed = piecesRemovedFind(appDirectory);
	return domainParts.filter((part) => {
		const piece = partPieces[part];
		return piece === undefined || !removed.includes(piece);
	});
};

// The refusal for parts this Project cannot have, or undefined.
export const domainPartsRefusal = ({
	appDirectory,
	parts,
}: {
	appDirectory: string;
	parts: DomainPart[];
}): string | undefined => {
	const available = partsAvailableFind(appDirectory);
	const missing = parts.find((part) => !available.includes(part));
	return missing === undefined
		? undefined
		: `--${missing} needs the ${partPieces[missing]} piece, which this Project removed`;
};

// What to do after a domain-create, for the flags used.
export const nextStepsText = ({
	migrated,
	names,
	parts,
	reads,
}: {
	// Whether a migration already creates the domain's table.
	migrated: boolean;
	names: DomainNames;
	parts: DomainPart[] | null;
	reads: string[];
}): string => {
	const domain = `src/domains/${names.kebab}`;
	const has = (part: DomainPart) => parts === null || parts.includes(part);
	const steps = [
		`Edit the Model in ${domain}/models/${names.kebab}.ts and the table in ${domain}/spi/${names.kebab}-table.ts; delete the Use cases, API operations and Rules it does not need.`,
		...(migrated
			? []
			: [
					`pnpm codegen --name ${names.kebab.replaceAll("-", "_")}_create writes its migration.`,
				]),
		...reads.map(
			(target) =>
				`Read what ${names.kebab} needs from ${target} in src/bridges/${names.kebab}-${target}-reader.ts and its port in ${domain}/ports.ts.`,
		),
		...(has("schedule")
			? [
					`Change or delete the stale-archive Schedule in ${domain}/api/${names.kebab}-schedule.ts.`,
				]
			: []),
		...(has("seed")
			? [`Seed what development needs in ${domain}/api/${names.kebab}-seed.ts.`]
			: []),
		...(has("pages")
			? [
					`Change the pages in src/ui/routes/${names.kebab}-list.tsx and ${names.kebab}-detail.tsx.`,
				]
			: []),
		"Business Rules, Consumers and outcome Events are yours to write: docs/agents/domain-create.md.",
	];
	return ["Next:", ...steps.map((step, k) => `  ${k + 1}. ${step}`)].join("\n");
};

// Whether a migration in migrations/ already creates the domain's schema.
const domainMigrationHas = (
	appDirectory: string,
	names: DomainNames,
): boolean => {
	const folder = join(appDirectory, "migrations");
	if (!existsSync(folder)) return false;
	const schema = `CREATE SCHEMA "${names.kebab.replaceAll("-", "_")}"`;
	return readdirSync(folder, { withFileTypes: true }).some(
		(d) =>
			d.isDirectory() &&
			existsSync(join(folder, d.name, "migration.sql")) &&
			readFileSync(join(folder, d.name, "migration.sql"), "utf8").includes(
				schema,
			),
	);
};

const usage = `Usage: pnpm domain-create <name> [--plural <plural>] [--bare] [parts] [--reads <domain>]...

Copies Foo, the Template's Domain, under <name>, renamed, and wires it into the Server, the
Worker and the UI. Add <name>'s **Term**: entry to CONTEXT.md first.

  --plural <plural>  the plural, when it is not <name>s
  --bare             only the core: Model, ports, errors, create/get/list/update/delete, the API,
                     repository (memory, Postgres, contract test), transaction, created and
                     deleted Events. Without --bare every part below is copied.
  --analytics        with --bare: track the created Event
  --cache            with --bare: a read-through cache on get
  --live             with --bare: live updates to pages
  --pages            with --bare: list and detail pages
  --schedule         with --bare: the stale-archive Schedule and its Use case
  --seed             with --bare: development rows
  --reads <domain>   reads <domain> through a Bridge: a reader port, its memory fake and
                     src/bridges/<name>-<domain>-reader.ts. Repeat it for more.
  -h, --help         this help

Never generated: business Rules, Consumers, outcome Events. See docs/agents/domain-create.md.`;

const fail = (message: string): never => {
	console.error(`domain-create: ${message}`);
	process.exit(1);
};

const main = () => {
	let parsed: ReturnType<typeof argsParse>;
	try {
		parsed = argsParse();
	} catch (error) {
		console.error(`domain-create: ${(error as Error).message}\n\n${usage}`);
		process.exit(1);
	}
	const { positionals, values } = parsed;
	if (values.help) {
		console.log(usage);
		return;
	}
	const [kebab] = positionals;
	if (kebab === undefined || positionals.length !== 1) {
		console.error(usage);
		process.exit(1);
	}
	const named = domainParts.filter((part) => values[part] === true);
	if (!values.bare && named.length > 0) {
		fail(
			`--${named.join(", --")} picks parts for --bare; without --bare every part is copied`,
		);
	}
	const parts = values.bare ? named : null;
	const reads = values.reads ?? [];
	const names: DomainNames = { kebab, plural: values.plural ?? `${kebab}s` };
	const appDirectory = process.cwd();
	const refusal =
		domainNameRefusal(names, appDirectory) ??
		domainPartsRefusal({ appDirectory, parts: named }) ??
		domainReadsRefusal({ appDirectory, names, reads });
	if (refusal !== undefined) fail(refusal);
	const template = monorepoAppIs(appDirectory)
		? filesRead(appDirectory)
		: templateFetch(templateJsonRead(appDirectory).release);
	let files: TemplateFile[] = [];
	try {
		files = domainFilesCreate({
			templateFull: template,
			appDirectory,
			names,
			parts,
			reads,
		});
	} catch (error) {
		fail((error as Error).message);
	}
	const wired = files.filter((f) => existsSync(join(appDirectory, f.path)));
	for (const file of files) {
		const target = join(appDirectory, file.path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, file.text);
	}
	console.log(
		`Wrote src/domains/${kebab}/ and wired it into ${wired.length} files; running pnpm check and pnpm test.`,
	);
	try {
		domainFilesFormat({ appDirectory, paths: files.map((f) => f.path) });
		for (const script of ["check", "test"]) {
			run({
				command: "pnpm",
				args: ["run", script],
				options: { cwd: appDirectory },
			});
		}
	} catch (error) {
		const { message, stdout } = error as Error & { stdout?: string };
		console.error(`${stdout ?? ""}${message}`);
		fail("the new domain does not pass format, check or unit tests yet");
	}
	console.log(
		`Created ${names.kebab}; pnpm check and pnpm test pass.\n${nextStepsText({
			migrated: domainMigrationHas(appDirectory, names),
			names,
			parts: parts ?? partsAvailableFind(appDirectory),
			reads,
		})}`,
	);
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
			reads: { multiple: true, type: "string" },
			schedule: { type: "boolean" },
			seed: { type: "boolean" },
		},
	});

if (import.meta.main) main();
