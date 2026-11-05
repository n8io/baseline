// Shared by domain-create, template-upgrade and app-create: fetches a baseline release and renders
// apps/app without the foo domain. Native TS, no dependencies; shells out to git and pnpm.
// Why a JS/TS-aware scanner renames foo instead of domain-create markers alone: foo also appears in
// regex literals, JSX text and prose, where a plain replace or a marker would rename the wrong text
// or miss it. render-and-test renders and tests a project on every PR, so it covers the scanner.
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export type TemplateAnswers = {
	// The project's package name, e.g. "invoicing".
	name: string;
	// The one-line project description: the first line of CONTEXT.md.
	description: string;
};

export type TemplateFile = { path: string; text: string };

export type DomainNames = { kebab: string; plural: string };

const templateRepository = "n8io/baseline";

// Runs a command and returns its stdout; `inherit` shows its output instead.
export const run = (
	command: string,
	args: string[],
	options: {
		cwd?: string;
		env?: NodeJS.ProcessEnv;
		inherit?: boolean;
		input?: string;
	} = {},
): string =>
	execFileSync(command, args, {
		cwd: options.cwd,
		encoding: "utf8",
		env: options.env ?? process.env,
		input: options.input,
		maxBuffer: 256 * 1024 * 1024,
		stdio: options.inherit ? "inherit" : ["pipe", "pipe", "inherit"],
	}) ?? "";

// ---------------------------------------------------------------------------
// Matching foo

// foo, Foo, FOO and the plurals foos, Foos, never part of a longer lowercase word (footer).
const fooPattern = /(foo|Foo|FOO)(s?)(?![a-z])/g;

export const fooLineIs = (line: string): boolean => {
	fooPattern.lastIndex = 0;
	return fooPattern.test(line);
};

type Mode = "code" | "string" | "comment";

const codeFileIs = (path: string): boolean => /\.(ts|tsx|js|mjs)$/.test(path);

const regexCanStart = /[(,=:[!&|?{};+\-*%~^]/;
const regexKeywords =
	/\b(return|typeof|case|do|else|in|of|void|yield|await|throw)\s*$/;

// A small lexer: the mode of every character, so renames and bracket counts can tell
// code from strings and comments. JSX text reads as code; fooProseIs handles it.
const modesRead = (text: string, path: string): Mode[] => {
	const modes: Mode[] = new Array(text.length);
	if (!codeFileIs(path)) return modes.fill("comment");
	const templateDepths: number[] = [];
	let braceDepth = 0;
	let i = 0;
	let previous = "";
	const mark = (from: number, to: number, mode: Mode) => {
		for (let k = from; k < to && k < text.length; k++) modes[k] = mode;
	};
	const stringSkip = (quote: string): number => {
		let k = i + 1;
		while (k < text.length && text[k] !== quote && text[k] !== "\n") {
			k += text[k] === "\\" ? 2 : 1;
		}
		return k + 1;
	};
	const templateSkip = (from: number): number => {
		let k = from;
		while (k < text.length) {
			if (text[k] === "\\") k += 2;
			else if (text[k] === "`") return k + 1;
			else if (text[k] === "$" && text[k + 1] === "{") return -(k + 2);
			else k++;
		}
		return k;
	};
	while (i < text.length) {
		const c = text[i] ?? "";
		const next = text[i + 1];
		if (c === "/" && next === "/") {
			const end = text.indexOf("\n", i);
			const to = end === -1 ? text.length : end;
			mark(i, to, "comment");
			i = to;
		} else if (c === "/" && next === "*") {
			const end = text.indexOf("*/", i + 2);
			const to = end === -1 ? text.length : end + 2;
			mark(i, to, "comment");
			i = to;
		} else if (c === '"' || c === "'") {
			const to = stringSkip(c);
			mark(i, to, "string");
			i = to;
			previous = c;
		} else if (
			c === "/" &&
			(previous === "" ||
				regexCanStart.test(previous) ||
				regexKeywords.test(text.slice(Math.max(0, i - 12), i)))
		) {
			let k = i + 1;
			let inClass = false;
			while (k < text.length && text[k] !== "\n") {
				if (text[k] === "\\") k++;
				else if (text[k] === "[") inClass = true;
				else if (text[k] === "]") inClass = false;
				else if (text[k] === "/" && !inClass) break;
				k++;
			}
			mark(i, text[k] === "\n" ? k : k + 1, "string");
			i = text[k] === "\n" ? k : k + 1;
			previous = "/";
		} else if (
			c === "`" ||
			(c === "}" && templateDepths.at(-1) === braceDepth)
		) {
			if (c === "}") templateDepths.pop();
			const to = templateSkip(i + 1);
			const end = Math.abs(to);
			mark(i, end, "string");
			if (to < 0) templateDepths.push(braceDepth);
			i = end;
			previous = "`";
		} else {
			if (c === "{") braceDepth++;
			if (c === "}") braceDepth--;
			modes[i] = "code";
			if (!/\s/.test(c)) previous = c;
			i++;
		}
	}
	return modes;
};

// ---------------------------------------------------------------------------
// Renaming foo to another domain

const camelFromKebab = (kebab: string): string =>
	kebab.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const pascalFromKebab = (kebab: string): string => {
	const camel = camelFromKebab(kebab);
	return camel.charAt(0).toUpperCase() + camel.slice(1);
};

const jsxKeywords = new Set([
	"as",
	"extends",
	"in",
	"instanceof",
	"of",
	"satisfies",
]);

// JSX text (`<h1>Foos</h1>`, `Back to foos`) is UI copy, not an identifier.
const fooProseIs = (text: string, start: number, end: number): boolean => {
	const next = text[end] ?? "";
	if (/[A-Za-z0-9_]/.test(next)) return false;
	if (text[start - 1] === ">" || next === "<") return true;
	if (next === "?" && !/[.:]/.test(text[end + 1] ?? "")) return true;
	const word = /^ ([a-z]+)/.exec(text.slice(end))?.[1];
	if (word !== undefined && !jsxKeywords.has(word)) return true;
	const lineStart = text.lastIndexOf("\n", start) + 1;
	const lineEnd = text.indexOf("\n", end);
	const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
	return /^\s*[A-Z]/.test(line) && !/[;(){}=<>"'`]/.test(line);
};

type Form = "camel" | "constant" | "kebab" | "snake" | "words";

// Which spelling an occurrence of foo takes, from where it stands.
const formPick = (
	text: string,
	modes: Mode[],
	start: number,
	end: number,
	path: string,
): Form => {
	const token = text.slice(start, end);
	const next = text[end] ?? "";
	const previous = text[start - 1] ?? "";
	if (token.startsWith("FOO")) return "constant";
	if (next === "_") return "snake";
	if (/[A-Z0-9]/.test(next)) return "camel";
	if (modes[start] === "code") {
		return path.endsWith(".tsx") && fooProseIs(text, start, end)
			? "words"
			: "camel";
	}
	if (text.slice(start - 9, start) === "baseline.") return "snake";
	if (text.slice(start - 6, start) === "/live/") return "snake";
	const quoted = /["'`]/.test(previous) && next === previous;
	if (quoted) return token.endsWith("s") ? "kebab" : "snake";
	if (/[.:]/.test(next) && /[a-z]/.test(text[end + 1] ?? "")) return "kebab";
	if (next === "-" || next === "/" || /[-/.:#]/.test(previous)) return "kebab";
	return "words";
};

const spell = (
	names: DomainNames,
	form: Form,
	token: string,
	plural: boolean,
): string => {
	const kebab = plural ? names.plural : names.kebab;
	const upper = token.startsWith("F");
	switch (form) {
		case "constant":
			return kebab.replaceAll("-", "_").toUpperCase();
		case "snake":
			return kebab.replaceAll("-", "_");
		case "kebab":
			return kebab;
		case "words": {
			const words = kebab.replaceAll("-", " ");
			return upper ? words.charAt(0).toUpperCase() + words.slice(1) : words;
		}
		case "camel":
			return upper ? pascalFromKebab(kebab) : camelFromKebab(kebab);
	}
};

// Renames every foo in a file's text: fooCreate → invoiceLineCreate, FOO_X → INVOICE_LINE_X,
// pgSchema("foo") → "invoice_line", "/foos" → "/invoice-lines", "foo:read" → "invoice-line:read".
export const fooRename = (
	text: string,
	names: DomainNames,
	path: string,
): string => {
	const modes = modesRead(text, path);
	return text.replace(
		fooPattern,
		(token: string, base: string, s: string, start: number) =>
			spell(
				names,
				formPick(text, modes, start, start + token.length, path),
				base,
				s === "s",
			),
	);
};

export const fooPathRename = (path: string, names: DomainNames): string =>
	path
		.replace(/(^|\/)foos(?=[-./]|$)/g, `$1${names.plural}`)
		.replace(/(^|\/|-)foo(?=[-./]|$)/g, `$1${names.kebab}`);

// ---------------------------------------------------------------------------
// Foo blocks: the whole statement a foo line belongs to

// Per line: bracket change, lowest point, and whether its line break sits inside a string.
const lineDepths = (
	text: string,
	modes: Mode[],
): { delta: number; low: number; open: boolean }[] => {
	const result: { delta: number; low: number; open: boolean }[] = [];
	let delta = 0;
	let low = 0;
	for (let i = 0; i <= text.length; i++) {
		const c = text[i];
		if (c === undefined || c === "\n") {
			result.push({ delta, low, open: modes[i] === "string" });
			delta = 0;
			low = 0;
			continue;
		}
		if (modes[i] !== "code") continue;
		if (c === "(" || c === "[" || c === "{") delta++;
		if (c === ")" || c === "]" || c === "}") {
			delta--;
			low = Math.min(low, delta);
		}
	}
	return result;
};

// Line ranges [start, end] (inclusive) holding foo. In code files a range grows to the whole
// bracket-balanced statement; in .env files it takes the item's `# @` decorator lines.
export const fooBlocksFind = (
	text: string,
	path: string,
): [number, number][] => {
	const lines = text.split("\n");
	const blocks: [number, number][] = [];
	const code = codeFileIs(path);
	const depths = code ? lineDepths(text, modesRead(text, path)) : [];
	const balance = (start: number, end: number) => {
		let depth = 0;
		let low = 0;
		for (let k = start; k <= end; k++) {
			const line = depths[k] ?? { delta: 0, low: 0, open: false };
			low = Math.min(low, depth + line.low);
			depth += line.delta;
		}
		return { depth, low };
	};
	for (let i = 0; i < lines.length; i++) {
		if (!fooLineIs(lines[i] ?? "")) continue;
		let start = i;
		let end = i;
		if (code) {
			for (;;) {
				if (start < 0 || end >= lines.length) {
					throw new Error(
						`${path}:${i + 1}: cannot find the statement around this foo line`,
					);
				}
				const { depth, low } = balance(start, end);
				const before = start - 1;
				if (
					low < 0 ||
					depths[before]?.open === true ||
					/=\s*$/.test(lines[before] ?? "")
				) {
					start--;
				} else if (
					depth > 0 ||
					depths[end]?.open === true ||
					/=\s*$/.test(lines[end] ?? "")
				) {
					end++;
				} else if (
					/[([{]\s*$/.test(lines[before] ?? "") &&
					/^\s*[)\]}]/.test(lines[end + 1] ?? "")
				) {
					// The block is all a bracket holds: the statement around it goes too.
					start--;
					end++;
				} else break;
			}
		} else if (/(^|\/)\.env\./.test(path)) {
			while (/^# @/.test(lines[start - 1] ?? "")) start--;
		}
		blocks.push([start, end]);
		i = Math.max(i, end);
	}
	// A later line's statement can reach back over earlier blocks: join overlapping and adjacent ones.
	const joined: [number, number][] = [];
	for (const [start, end] of blocks.sort((a, b) => a[0] - b[0])) {
		const last = joined.at(-1);
		if (last !== undefined && start <= last[1] + 1) {
			last[1] = Math.max(last[1], end);
		} else {
			joined.push([start, end]);
		}
	}
	return joined;
};

export const linesRemove = (
	text: string,
	blocks: [number, number][],
): string => {
	const lines = text.split("\n");
	const drop = new Set<number>();
	for (const [start, end] of blocks) {
		for (let k = start; k <= end; k++) drop.add(k);
	}
	return lines.filter((_, k) => !drop.has(k)).join("\n");
};

// ---------------------------------------------------------------------------
// Rendering without foo

// Files and folders that are foo's alone, deleted whole.
const templateFooPaths = [
	/^src\/domains\/foo\//,
	/^src\/ui\/routes\/(foo-[^/]+|home)(\.test)?\.tsx?$/,
	// Integration tests that drive foo are named foo-*.test.ts.
	/^test\/integration\/foo-[^/]+\.test\.ts$/,
	/^src\/server-seed\.test\.ts$/,
	/^migrations\/[^/]*foo[^/]*\//,
];

// Never rendered: the scripts and their tests name foo on purpose, and the changelog is the template's own.
const templateUntouchedPaths = [/^scripts\//];
const templateSkippedPaths = [/^CHANGELOG\.md$/];

// Lines between a `domain-create: domains-start` and `domains-end` marker pair are valid only while
// a domain exists. The render empties each pair; domain-create fills them for the first domain.
const domainsStart = /^\s*(\/\/|#) domain-create: domains-start\s*$/;
const domainsEnd = /^\s*(\/\/|#) domain-create: domains-end\s*$/;

// Each pair's marker lines [start, end].
export const domainsPairsFind = (
	text: string,
	path: string,
): [number, number][] => {
	const pairs: [number, number][] = [];
	let start: number | undefined;
	for (const [k, line] of text.split("\n").entries()) {
		const misplaced = domainsStart.test(line)
			? start !== undefined
			: domainsEnd.test(line) && start === undefined;
		if (misplaced) {
			throw new Error(`${path}:${k + 1}: domain-create markers must pair up`);
		}
		if (domainsStart.test(line)) start = k;
		if (domainsEnd.test(line) && start !== undefined) {
			pairs.push([start, k]);
			start = undefined;
		}
	}
	if (start !== undefined) {
		throw new Error(`${path}:${start + 1}: domains-start has no domains-end`);
	}
	return pairs;
};

export const domainsPairsEmpty = (text: string, path: string): string =>
	linesRemove(
		text,
		domainsPairsFind(text, path).map(([start, end]) => [start + 1, end - 1]),
	);

// CONTEXT.md keeps every Architecture term; only the **Foo**: entry goes.
const contextRender = (text: string, answers: TemplateAnswers): string => {
	const lines = text.split("\n");
	lines[0] = `# ${answers.description}`;
	const start = lines.indexOf("**Foo**:");
	if (start === -1) return lines.join("\n");
	let end = start;
	while (end < lines.length && (lines[end] ?? "") !== "") end++;
	lines.splice(start, end - start + 1);
	return lines.join("\n").replace(/\n+$/, "\n");
};

export const templateFileRender = (
	file: TemplateFile,
	answers: TemplateAnswers,
): TemplateFile | undefined => {
	const { path, text } = file;
	if (templateSkippedPaths.some((p) => p.test(path))) return undefined;
	if (templateFooPaths.some((p) => p.test(path))) return undefined;
	if (templateUntouchedPaths.some((p) => p.test(path))) return file;
	if (path === "CONTEXT.md")
		return { path, text: contextRender(text, answers) };
	// A Project's biome.json is its root config, not one nested in the monorepo.
	if (path === "biome.json") {
		return { path, text: text.replace(/\n\t"root": false,/, "") };
	}
	if (path === "package.json") {
		const manifest = JSON.parse(text) as Record<string, unknown>;
		manifest.name = answers.name;
		// The version is the project's own, never the template's.
		delete manifest.version;
		return { path, text: `${JSON.stringify(manifest, null, "\t")}\n` };
	}
	if (!fooLineIs(text)) return file;
	const emptied = domainsPairsEmpty(text, path);
	return { path, text: linesRemove(emptied, fooBlocksFind(emptied, path)) };
};

// ---------------------------------------------------------------------------
// Reading and writing a tree of files

const skippedDirectories = new Set([
	".git",
	".react-router",
	"build",
	"node_modules",
]);

export const filesRead = (root: string, relative = ""): TemplateFile[] => {
	const files: TemplateFile[] = [];
	for (const entry of readdirSync(join(root, relative), {
		withFileTypes: true,
	})) {
		const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
		if (entry.isDirectory()) {
			if (!skippedDirectories.has(entry.name))
				files.push(...filesRead(root, path));
		} else if (entry.isFile()) {
			files.push({ path, text: readFileSync(join(root, path), "utf8") });
		}
	}
	return files.sort((a, b) => (a.path < b.path ? -1 : 1));
};

export const filesWrite = (root: string, files: TemplateFile[]): void => {
	for (const file of files) {
		const target = join(root, file.path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, file.text);
	}
};

// Renders every file; src/domains/ stays as an empty folder the structure test reads.
export const templateFilesRender = (
	files: TemplateFile[],
	answers: TemplateAnswers,
): TemplateFile[] => [
	...files.flatMap((file) => templateFileRender(file, answers) ?? []),
	{ path: "src/domains/.gitkeep", text: "" },
];

// Line removal leaves formatting and unused imports for Biome, and src/env.d.ts for varlock.
// Runs both with the tools of `toolsDirectory` (a project or apps/app with node_modules).
export const templateFinish = (
	directory: string,
	toolsDirectory: string,
): void => {
	const modules = join(directory, "node_modules");
	const linked = !existsSync(modules);
	if (linked) symlinkSync(join(toolsDirectory, "node_modules"), modules);
	try {
		const bin = (name: string) => join(modules, ".bin", name);
		run(
			bin("biome"),
			[
				"lint",
				"--write",
				"--unsafe",
				"--only=correctness/noUnusedImports",
				".",
			],
			{ cwd: directory },
		);
		run(bin("biome"), ["check", "--write", "."], { cwd: directory });
		run(bin("varlock"), ["codegen"], { cwd: directory });
	} finally {
		if (linked) rmSync(modules);
	}
};

// ---------------------------------------------------------------------------
// Fetching a release

const releaseTag = (version: string): string => `app@${version}`;

export const releaseLatest = (): string => {
	const tags = run("git", [
		"ls-remote",
		"--tags",
		"--refs",
		`https://github.com/${templateRepository}.git`,
		"app@*",
	]);
	const versions = [...tags.matchAll(/refs\/tags\/app@(\d+)\.(\d+)\.(\d+)$/gm)]
		.map((m) => [Number(m[1]), Number(m[2]), Number(m[3])] as const)
		.filter(([major]) => major > 0)
		.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
	const latest = versions.at(-1);
	if (latest === undefined)
		throw new Error(`No app@ release in ${templateRepository}`);
	return latest.join(".");
};

// The template's own workspace settings, which the monorepo root holds for apps/app.
const workspaceRender = (rootWorkspace: string): string =>
	rootWorkspace.replace(/^packages:\n(?: {2}- .*\n)*/m, "");

// Exports apps/app at `ref` of a baseline checkout: files with `git archive`, package.json from
// `pnpm pack` (workspace:^ becomes a caret range; pnpm pack writes a lockfile, so use a throwaway
// checkout) and pnpm-workspace.yaml from the root. Returns the unrendered files, foo included.
export const templateExport = (
	checkout: string,
	ref: string,
): TemplateFile[] => {
	const work = mkdtempSync(join(tmpdir(), "template-export-"));
	try {
		const app = join(work, "app");
		mkdirSync(app);
		const archive = join(work, "app.tar");
		run("git", ["archive", "--output", archive, `${ref}:apps/app`], {
			cwd: checkout,
		});
		run("tar", ["-xf", archive, "-C", app]);
		const packed = join(work, "packed");
		mkdirSync(packed);
		run("pnpm", ["pack", "--pack-destination", packed], {
			cwd: join(checkout, "apps/app"),
		});
		const tarball = readdirSync(packed).find((f) => f.endsWith(".tgz"));
		if (tarball === undefined) throw new Error("pnpm pack wrote no tarball");
		run("tar", [
			"-xzf",
			join(packed, tarball),
			"-C",
			packed,
			"package/package.json",
		]);
		// pnpm pack drops packageManager, which CI's pnpm setup reads.
		const manifest = JSON.parse(
			readFileSync(join(packed, "package/package.json"), "utf8"),
		) as Record<string, unknown>;
		const { packageManager } = JSON.parse(
			readFileSync(join(checkout, "apps/app/package.json"), "utf8"),
		) as { packageManager: string };
		writeFileSync(
			join(app, "package.json"),
			`${JSON.stringify({ ...manifest, packageManager }, null, "\t")}\n`,
		);
		writeFileSync(
			join(app, "pnpm-workspace.yaml"),
			workspaceRender(
				readFileSync(join(checkout, "pnpm-workspace.yaml"), "utf8"),
			),
		);
		return filesRead(app);
	} finally {
		rmSync(work, { force: true, recursive: true });
	}
};

// Clones the release (blobless) and exports its apps/app, then removes the clone.
export const templateFetch = (version: string): TemplateFile[] => {
	const work = mkdtempSync(join(tmpdir(), "template-"));
	try {
		const clone = join(work, "clone");
		run("git", [
			"clone",
			"--quiet",
			"--filter=blob:none",
			"--branch",
			releaseTag(version),
			`https://github.com/${templateRepository}.git`,
			clone,
		]);
		return templateExport(clone, releaseTag(version));
	} finally {
		rmSync(work, { force: true, recursive: true });
	}
};

export const monorepoAppIs = (appDirectory: string): boolean =>
	existsSync(join(appDirectory, "../../packages/result/package.json")) &&
	!existsSync(join(appDirectory, ".template.json"));

type TemplateJson = { release: string; description: string };

export const templateJsonRead = (appDirectory: string): TemplateJson =>
	JSON.parse(
		readFileSync(join(appDirectory, ".template.json"), "utf8"),
	) as TemplateJson;

export const templateAnswers = (
	appDirectory: string,
	template: TemplateJson,
): TemplateAnswers => {
	const manifest = JSON.parse(
		readFileSync(join(appDirectory, "package.json"), "utf8"),
	) as { name: string };
	return {
		description: template.description,
		name: manifest.name,
	};
};
