// pnpm domain-create <name> [--plural <plural>]: copies the foo domain and its two pages from the
// template release, renamed, and wires the copy in at every `domain-create:` marker. Writes no
// migration and never commits; run `pnpm codegen` after editing the table.
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
	type DomainNames,
	domainsPairsFind,
	filesRead,
	fooBlocksFind,
	fooLineIs,
	fooPathRename,
	fooRename,
	linesRemove,
	monorepoAppIs,
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
// home.tsx (the / redirect) and its test come back with the first domain, which it redirects to.
const firstDomainPaths = new Set([
	"src/ui/routes/home.tsx",
	"src/ui/routes/home.test.ts",
]);

// The pieces of the stack a Project may remove with pnpm piece-remove. A removed piece's
// package is gone from package.json; its files and its `piece-start:` blocks stay out of a new
// domain.
const pieces = [
	{ name: "ui", package: "react-router", paths: [/^src\/ui\//] },
	{
		name: "live",
		package: "@n8io/baseline-live",
		paths: [/^src\/domains\/foo\/.*-live(\.test)?\.ts$/],
	},
	{
		name: "cache",
		package: "@n8io/baseline-cache",
		paths: [/^src\/domains\/foo\/.*-cache(d|\.[a-z.]+)\.ts$/],
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

// The first domain fills each emptied domains-start/domains-end pair with the template's lines,
// foo's left out, and imports the template names the render's Biome pass dropped as unused.
export const domainsPairsFill = (
	project: string,
	template: string,
	path: string,
): string => {
	const lines = project.split("\n");
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
	for (const [k, [start, end]] of [...pairs.entries()].reverse()) {
		const [from, to] = sourcePairs[k] ?? [0, 0];
		if (end === start + 1) {
			lines.splice(start + 1, 0, ...source.slice(from + 1, to));
		}
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
	lines.splice(importEnd(lines) + 1, 0, ...missing);
	return lines.join("\n");
};

// Adds the renamed copy of each foo line in the template's version of a file to the project's
// version: above the same marker, or after the imports for an import.
export const wiringInsert = (
	project: string,
	template: string,
	path: string,
	names: DomainNames,
	firstDomain: boolean,
): string => {
	const lines = (
		firstDomain ? domainsPairsFill(project, template, path) : project
	).split("\n");
	const templateLines = template.split("\n");
	const blocks = fooBlocksFind(template, path);
	const inBlock = (k: number) => blocks.some(([s, e]) => k >= s && k <= e);
	const imports: string[] = [];
	for (const [start, end] of blocks) {
		const text = fooRename(
			templateLines.slice(start, end + 1).join("\n"),
			names,
			path,
		);
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

// The files a new domain adds or changes, from the template's files and the project's.
export const domainFilesCreate = (
	templateFull: TemplateFile[],
	appDirectory: string,
	names: DomainNames,
): TemplateFile[] => {
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
	const copied = (path: string) =>
		copiedPaths.some((p) => p.test(path)) ||
		(firstDomain && firstDomainPaths.has(path));
	// Checked before anything is built, so a refusal writes nothing.
	for (const file of template.filter((f) => copied(f.path))) {
		const path = fooPathRename(file.path, names);
		if (existsSync(join(appDirectory, path))) {
			throw new Error(`${path} already exists; move it aside first`);
		}
	}
	const files: TemplateFile[] = [];
	for (const file of template) {
		if (copied(file.path)) {
			files.push({
				path: fooPathRename(file.path, names),
				text: fooRename(file.text, names, file.path),
			});
			continue;
		}
		if (
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
			text: wiringInsert(project, file.text, file.path, names, firstDomain),
		});
	}
	return files;
};

const main = () => {
	const { positionals, values } = parseArgs({
		allowPositionals: true,
		options: { plural: { type: "string" } },
	});
	const [kebab] = positionals;
	if (kebab === undefined || positionals.length !== 1) {
		console.error("Usage: pnpm domain-create <name> [--plural <plural>]");
		process.exit(1);
	}
	const names: DomainNames = { kebab, plural: values.plural ?? `${kebab}s` };
	const appDirectory = process.cwd();
	const refusal = domainNameRefusal(names, appDirectory);
	if (refusal !== undefined) {
		console.error(`domain-create: ${refusal}`);
		process.exit(1);
	}
	const template = monorepoAppIs(appDirectory)
		? filesRead(appDirectory)
		: templateFetch(templateJsonRead(appDirectory).release);
	let files: TemplateFile[];
	try {
		files = domainFilesCreate(template, appDirectory, names);
	} catch (error) {
		console.error(`domain-create: ${(error as Error).message}`);
		process.exit(1);
	}
	for (const file of files) {
		const target = join(appDirectory, file.path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, file.text);
	}
	console.log(`Created src/domains/${kebab}/; checking it.`);
	try {
		const paths = files.map((f) => f.path);
		// A removed piece's blocks leave imports nothing uses.
		const unusedImports = "--only=correctness/noUnusedImports";
		run(
			"pnpm",
			["exec", "biome", "lint", "--write", "--unsafe", unusedImports, ...paths],
			{
				cwd: appDirectory,
			},
		);
		run("pnpm", ["exec", "biome", "check", "--write", ...paths], {
			cwd: appDirectory,
		});
		for (const script of ["check", "test"]) {
			run("pnpm", ["run", script], { cwd: appDirectory, inherit: true });
		}
	} catch {
		console.error(
			"domain-create: the new domain does not pass format, typecheck or unit tests yet",
		);
		process.exit(1);
	}
	console.log(
		`Done. Edit the ${kebab} model, delete what it does not need, then run pnpm codegen for its migration.`,
	);
};

if (import.meta.main) main();
