// Shared by context-create, aggregate-create, template-upgrade and app-create: fetches a baseline
// release and renders apps/app without the foo context. Native TS, no dependencies; shells out to
// git and pnpm.
// Why a JS/TS-aware scanner renames foo instead of wiring markers alone: foo also appears in
// regex literals, JSX text and prose, where a plain replace or a marker would rename the wrong text
// or miss it. render-and-test renders and tests a project on every PR, so it covers the scanner.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempDisposableSync,
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

// Runs a command and returns its stdout. Its stderr is kept out of the terminal: a failure's error
// carries it, so a run that works prints nothing alarming. `inherit` shows all its output instead.
export const run = ({
	args,
	command,
	options = {},
}: {
	args: string[];
	command: string;
	options?: {
		cwd?: string;
		env?: NodeJS.ProcessEnv;
		inherit?: boolean;
		input?: string;
	};
}): string =>
	execFileSync(command, args, {
		cwd: options.cwd,
		encoding: "utf8",
		env: options.env ?? process.env,
		input: options.input,
		maxBuffer: 256 * 1024 * 1024,
		stdio: options.inherit ? "inherit" : "pipe",
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

export const codeFileIs = (path: string): boolean =>
	/\.(ts|tsx|js|mjs)$/.test(path);

const regexCanStart = /[(,=:[!&|?{};+\-*%~^]/;
const regexKeywords =
	/\b(return|typeof|case|do|else|in|of|void|yield|await|throw)\s*$/;

// A small lexer: the mode of every character, so renames and bracket counts can tell
// code from strings and comments. JSX text reads as code; fooProseIs handles it.
export const modesRead = (text: string, path: string): Mode[] => {
	const modes: Mode[] = new Array(text.length);
	if (!codeFileIs(path)) return modes.fill("comment");
	const templateDepths: number[] = [];
	let braceDepth = 0;
	let i = 0;
	let previous = "";
	const mark = ({
		from,
		mode,
		to,
	}: {
		from: number;
		mode: Mode;
		to: number;
	}) => {
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
			mark({ from: i, to, mode: "comment" });
			i = to;
		} else if (c === "/" && next === "*") {
			const end = text.indexOf("*/", i + 2);
			const to = end === -1 ? text.length : end + 2;
			mark({ from: i, to, mode: "comment" });
			i = to;
		} else if (c === '"' || c === "'") {
			const to = stringSkip(c);
			mark({ from: i, to, mode: "string" });
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
			mark({ from: i, to: text[k] === "\n" ? k : k + 1, mode: "string" });
			i = text[k] === "\n" ? k : k + 1;
			previous = "/";
		} else if (
			c === "`" ||
			(c === "}" && templateDepths.at(-1) === braceDepth)
		) {
			if (c === "}") templateDepths.pop();
			const to = templateSkip(i + 1);
			const end = Math.abs(to);
			mark({ from: i, to: end, mode: "string" });
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

export const camelFromKebab = (kebab: string): string =>
	kebab.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
export const pascalFromKebab = (kebab: string): string => {
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
const fooProseIs = ({
	end,
	start,
	text,
}: {
	end: number;
	start: number;
	text: string;
}): boolean => {
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
const formPick = ({
	end,
	modes,
	path,
	start,
	text,
}: {
	end: number;
	modes: Mode[];
	path: string;
	start: number;
	text: string;
}): Form => {
	const token = text.slice(start, end);
	const next = text[end] ?? "";
	const previous = text[start - 1] ?? "";
	if (token.startsWith("FOO")) return "constant";
	if (next === "_") return "snake";
	if (/[A-Z0-9]/.test(next)) return "camel";
	if (modes[start] === "code") {
		return path.endsWith(".tsx") && fooProseIs({ text, start, end })
			? "words"
			: "camel";
	}
	if (text.slice(start - 9, start) === "baseline.") return "snake";
	if (text.slice(start - 6, start) === "/live/") return "snake";
	// An OpenAPI tag is the prefix of its operationIds: tags: ["invoiceLine"] beside "invoiceLineGet".
	if (text.slice(start - 8, start) === 'tags: ["') return "camel";
	const quoted = /["'`]/.test(previous) && next === previous;
	if (quoted) return token.endsWith("s") ? "kebab" : "snake";
	if (/[.:]/.test(next) && /[a-z]/.test(text[end + 1] ?? "")) return "kebab";
	if (next === "-" || next === "/" || /[-/.:#]/.test(previous)) return "kebab";
	return "words";
};

const spell = ({
	form,
	names,
	plural,
	token,
}: {
	form: Form;
	names: DomainNames;
	plural: boolean;
	token: string;
}): string => {
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
export const fooRename = ({
	names,
	path,
	text,
}: {
	names: DomainNames;
	path: string;
	text: string;
}): string => {
	const modes = modesRead(text, path);
	return text.replace(
		fooPattern,
		// biome-ignore lint/complexity/useMaxParams: String.replace passes each match this way.
		(token: string, base: string, s: string, start: number) =>
			spell({
				names,
				form: formPick({ text, modes, start, end: start + token.length, path }),
				token: base,
				plural: s === "s",
			}),
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

// Line ranges [start, end] (inclusive) holding foo, or the lines `lineIs` picks. In code files a
// range grows to the whole bracket-balanced statement; in .env files it takes the item's `# @`
// decorator lines.
export const fooBlocksFind = (text: string, path: string): [number, number][] =>
	linesBlocksFind({ lineIs: fooLineIs, path, text });

export const linesBlocksFind = ({
	lineIs,
	path,
	text,
}: {
	lineIs: (line: string) => boolean;
	path: string;
	text: string;
}): [number, number][] => {
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
		if (!lineIs(lines[i] ?? "")) continue;
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
					// A type argument list spread over lines (`Parameters<` … `>[0][],`) counts too.
					/(=|<)\s*$/.test(lines[before] ?? "")
				) {
					start--;
				} else if (
					depth > 0 ||
					depths[end]?.open === true ||
					/(=|<)\s*$/.test(lines[end] ?? "") ||
					/^\s*>/.test(lines[end + 1] ?? "")
				) {
					end++;
				} else if (
					/[([{]\s*$/.test(lines[before] ?? "") &&
					lineIs(lines[end + 1] ?? "")
				) {
					// The next argument names foo too: it may be all the bracket holds, and then
					// the statement around it goes (app.route("/live/foo", fooLive...(...))).
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
	/^src\/contexts\/foo\//,
	/^src\/ui\/routes\/(foo-[^/]+|home)(\.test)?\.tsx?$/,
	// Integration tests that drive foo are named foo-*.test.ts.
	/^test\/integration\/foo-[^/]+\.test\.ts$/,
	/^migrations\/[^/]*foo[^/]*\//,
];

// Never rendered: the scripts and their tests name foo on purpose, and the changelog is the template's own.
// The lockfile names no foo, but an integrity hash can hold "Foo", and dropping that line breaks it.
const templateUntouchedPaths = [/^scripts\//, /^pnpm-lock\.yaml$/];
const templateSkippedPaths = [/^CHANGELOG\.md$/];

// Lines between a `wiring: contexts-start` and `contexts-end` marker pair are valid only while
// a context exists. The render empties each pair; context-create and aggregate-create fill them.
const domainsStart = /^\s*(\/\/|#) wiring: contexts-start\s*$/;
const domainsEnd = /^\s*(\/\/|#) wiring: contexts-end\s*$/;

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
			throw new Error(`${path}:${k + 1}: wiring markers must pair up`);
		}
		if (domainsStart.test(line)) start = k;
		if (domainsEnd.test(line) && start !== undefined) {
			pairs.push([start, k]);
			start = undefined;
		}
	}
	if (start !== undefined) {
		throw new Error(`${path}:${start + 1}: contexts-start has no contexts-end`);
	}
	return pairs;
};

export const domainsPairsEmpty = (text: string, path: string): string =>
	linesRemove(
		text,
		domainsPairsFind(text, path).map(([start, end]) => [start + 1, end - 1]),
	);

// CONTEXT.md keeps every Architecture term as written, foo in their examples too; its title
// becomes the Project's description. foo's own terms live in src/contexts/foo/, which never renders.
const contextRender = (text: string, answers: TemplateAnswers): string => {
	const lines = text.split("\n");
	lines[0] = `# ${answers.description}`;
	return lines.join("\n");
};

// README.md names the Project and the release it was made from: its `# app` title becomes the
// Project's name, its bold line the description, and its first `<sub>` line, which describes the
// Template, a link to the release's changelog. A README missing one of them throws, so the
// Template's README cannot drift from this.
export const readmeRender = ({
	answers,
	release,
	text,
}: {
	answers: TemplateAnswers;
	release: string;
	text: string;
}): string => {
	const lines = text.split("\n");
	const description = lines.findIndex((line) => /^\*\*.+\*\*$/.test(line));
	const made = lines.findIndex((line) => line.startsWith("<sub>"));
	if (lines[0] !== "# app" || description === -1 || made === -1) {
		throw new Error(
			"README.md: needs a `# app` title, a bold description line and a <sub> line",
		);
	}
	if (release === "") throw new Error("README.md: package.json has no version");
	const tag = `app@${release}`;
	lines[0] = `# ${answers.name}`;
	lines[description] = `**${answers.description.trim()}**`;
	lines[made] =
		`<sub>Made from [baseline](https://github.com/${templateRepository}) [${tag}](https://github.com/${templateRepository}/blob/${encodeURIComponent(tag)}/apps/app/CHANGELOG.md). \`pnpm template-upgrade\` takes a newer release.</sub>`;
	return lines.join("\n");
};

// A Project's own ports, from its name, so two Projects run side by side on one machine: seven in a
// row at a multiple of ten from 20000 to 29999, below the range the OS hands out to outgoing
// connections. compose.yaml publishes the four *_HOST_PORT ones (.env.schema); `pnpm dev` serves on
// PORT and HEALTH_PORT (.env.development) and the Worker's health port (its `dev` script). The
// Template keeps 5432, 6379, 3000, 9000 and 9001. Two names can land on the same block (one in a
// thousand): change the four *_HOST_PORT values in .env.schema, PORT and HEALTH_PORT in
// .env.development and the Worker's HEALTH_PORT in the `dev` script then.
export const hostPortsCreate = (name: string): Record<string, number> => {
	const block =
		createHash("sha256").update(name).digest().readUInt32BE(0) % 1000;
	const first = 20_000 + block * 10;
	return {
		POSTGRES_HOST_PORT: first,
		REDIS_HOST_PORT: first + 1,
		SERVER_HOST_PORT: first + 2,
		HEALTH_HOST_PORT: first + 3,
		PORT: first + 4,
		HEALTH_PORT: first + 5,
		WORKER_HEALTH_PORT: first + 6,
	};
};

// The Template's own name ("app") in the compose project name and in every `docker compose -p`.
const composeProjectRender = (text: string, name: string): string =>
	text
		.replace(/^name: app$/m, `name: ${name}`)
		.replaceAll("-p app ", `-p ${name} `);

// Which of hostPortsCreate's ports each env file sets; .env.schema keeps the production PORT and
// HEALTH_PORT.
const hostPortItems: Record<string, string[]> = {
	".env.development": ["PORT", "HEALTH_PORT"],
	".env.schema": [
		"POSTGRES_HOST_PORT",
		"REDIS_HOST_PORT",
		"SERVER_HOST_PORT",
		"HEALTH_HOST_PORT",
	],
};

const hostPortsRender = (file: TemplateFile, name: string): string => {
	const ports = hostPortsCreate(name);
	return (hostPortItems[file.path] ?? []).reduce(
		(rendered, item) =>
			rendered.replace(
				new RegExp(`^${item}=\\d+$`, "m"),
				`${item}=${ports[item]}`,
			),
		file.text,
	);
};

// The development Environment is the Project's own `pnpm dev` (PORT), in clients/environments.json
// and in the SDK's copy of the document, which the sdk-generate script writes from it.
const developmentUrlRender = (text: string, name: string): string =>
	text.replaceAll(
		"http://localhost:3000",
		`http://localhost:${hostPortsCreate(name).PORT}`,
	);

// The dev Worker's HEALTH_PORT, which the `dev` script sets in front of it.
const workerHealthPortRender = (text: string, name: string): string =>
	text.replace(
		/HEALTH_PORT=9001 /,
		`HEALTH_PORT=${hostPortsCreate(name).WORKER_HEALTH_PORT} `,
	);

// The SDK's files (the sdk piece). Its generated files are rendered as pnpm sdk-generate writes
// them for a Project with no bounded context: the document without foo's operations and schemas,
// and an sdk.ts that is only its header comment.
const sdkFileRender = (
	file: TemplateFile,
	answers: TemplateAnswers,
): TemplateFile | undefined => {
	const { path, text } = file;
	if (path === "clients/sdk/package.json") {
		const manifest = JSON.parse(text) as Record<string, unknown>;
		manifest.name = `${answers.name}-sdk`;
		return { path, text: `${JSON.stringify(manifest, null, "\t")}\n` };
	}
	if (path === "clients/sdk/sdk.ts") {
		// orval writes the header and a blank line for a document with no operations.
		const header = /^\/\*\*[\s\S]*?\*\/\n/.exec(text)?.[0] ?? "";
		return { path, text: `${header}\n` };
	}
	if (path !== "clients/sdk/openapi.json") return undefined;
	const document = JSON.parse(text) as {
		components?: { schemas?: Record<string, unknown> };
		info: { title: string };
		paths: Record<string, unknown>;
	};
	const fooless = (record: Record<string, unknown>) =>
		Object.fromEntries(
			Object.entries(record).filter(([key]) => !fooLineIs(key)),
		);
	document.info.title = answers.name;
	document.paths = fooless(document.paths);
	// Bar's schemas go with foo's: Bar is foo's second Aggregate, whose names do not say foo.
	if (document.components?.schemas !== undefined) {
		document.components.schemas = Object.fromEntries(
			Object.entries(fooless(document.components.schemas)).filter(
				([key]) => !/^Bar[A-Z]/.test(key),
			),
		);
	}
	// Compact, as pnpm sdk-generate saves it; templateFinish formats both alike.
	return {
		path,
		text: developmentUrlRender(JSON.stringify(document), answers.name),
	};
};

// The CLI's files (the cli piece): its package, its command and the SDK it runs on take the
// Project's name.
const cliFileRender = (
	file: TemplateFile,
	answers: TemplateAnswers,
): TemplateFile | undefined => {
	const { path } = file;
	if (!path.startsWith("clients/cli/")) return undefined;
	const text = file.text.replaceAll("app-sdk", `${answers.name}-sdk`);
	if (path !== "clients/cli/package.json") return { path, text };
	const manifest = JSON.parse(text) as Record<string, unknown>;
	manifest.name = `${answers.name}-cli`;
	manifest.bin = { [answers.name]: "./cli.ts" };
	return { path, text: `${JSON.stringify(manifest, null, "\t")}\n` };
};

export const templateFileRender = (
	file: TemplateFile,
	answers: TemplateAnswers,
): TemplateFile | undefined => {
	const clientFile =
		sdkFileRender(file, answers) ?? cliFileRender(file, answers);
	if (clientFile !== undefined) return clientFile;
	const { path, text } = file;
	if (templateSkippedPaths.some((p) => p.test(path))) return undefined;
	if (templateFooPaths.some((p) => p.test(path))) return undefined;
	if (templateUntouchedPaths.some((p) => p.test(path))) return file;
	if (path === "CONTEXT.md")
		return { path, text: contextRender(text, answers) };
	if (path === "clients/environments.json")
		return { path, text: developmentUrlRender(text, answers.name) };
	// A Project's biome.json is its root config, not one nested in the monorepo.
	if (path === "biome.json") {
		return { path, text: text.replace(/\n\t"root": false,/, "") };
	}
	if (path === "package.json") {
		const manifest = JSON.parse(text) as Record<string, unknown>;
		manifest.name = answers.name;
		// The version is the project's own, never the template's.
		delete manifest.version;
		return {
			path,
			text: workerHealthPortRender(
				composeProjectRender(
					`${JSON.stringify(manifest, null, "\t")}\n`,
					answers.name,
				),
				answers.name,
			),
		};
	}
	const rendered = Object.hasOwn(hostPortItems, path)
		? hostPortsRender(file, answers.name)
		: path === "compose.yaml"
			? composeProjectRender(text, answers.name)
			: text;
	// A root with no foo line, such as the Worker, may still hold a pair to empty.
	if (!fooLineIs(rendered) && domainsPairsFind(rendered, path).length === 0) {
		return { path, text: rendered };
	}
	const emptied = domainsPairsEmpty(rendered, path);
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

// Renders every file; src/contexts/ stays as an empty folder the structure test reads.
export const templateFilesRender = (
	files: TemplateFile[],
	answers: TemplateAnswers,
): TemplateFile[] => {
	// README.md names the release package.json holds. It skips the foo-line removal: the leftovers
	// test in template-render.test.ts holds it free of foo.
	const manifest = files.find((file) => file.path === "package.json");
	const { version } = JSON.parse(manifest?.text ?? "{}") as {
		version?: string;
	};
	return [
		...files.flatMap((file) =>
			file.path === "README.md"
				? {
						...file,
						text: readmeRender({
							answers,
							release: version ?? "",
							text: file.text,
						}),
					}
				: (templateFileRender(file, answers) ?? []),
		),
		{ path: "src/contexts/.gitkeep", text: "" },
	];
};

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
		run({
			command: bin("biome"),
			args: [
				"lint",
				"--write",
				"--unsafe",
				"--only=correctness/noUnusedImports",
				".",
			],
			options: { cwd: directory },
		});
		run({
			command: bin("biome"),
			args: ["check", "--write", "."],
			options: { cwd: directory },
		});
		try {
			run({
				command: bin("varlock"),
				args: ["codegen"],
				options: { cwd: directory },
			});
		} catch (error) {
			// A render across a secret-store swap names a varlock plugin these tools lack. The render
			// keeps its src/env.d.ts as it is; pnpm check regenerates it once the install has the plugin.
			const plugin = /Plugin "([^"]+)" unable to resolve/.exec(
				(error as Error).message,
			)?.[1];
			if (plugin === undefined) throw error;
			console.warn(
				`templateFinish: src/env.d.ts not regenerated, ${plugin} is not installed here`,
			);
		}
	} finally {
		if (linked) rmSync(modules);
	}
};

// ---------------------------------------------------------------------------
// Fetching a release

const releaseTag = (version: string): string => `app@${version}`;

export const releaseLatest = (): string => {
	const tags = run({
		command: "git",
		args: [
			"ls-remote",
			"--tags",
			"--refs",
			`https://github.com/${templateRepository}.git`,
			"app@*",
		],
	});
	const versions = [...tags.matchAll(/refs\/tags\/app@(\d+)\.(\d+)\.(\d+)$/gm)]
		.map((m) => [Number(m[1]), Number(m[2]), Number(m[3])] as const)
		.filter(([major]) => major > 0)
		.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
	const latest = versions.at(-1);
	if (latest === undefined)
		throw new Error(`No app@ release in ${templateRepository}`);
	return latest.join(".");
};

// The template's own workspace settings, which the monorepo root holds for apps/app. A Project's
// root is the app, and clients/ holds the packages made from its API.
export const workspaceRender = (rootWorkspace: string): string =>
	rootWorkspace.replace(
		/^packages:\n(?: {2}- .*\n)*/m,
		[
			"# piece-start: sdk",
			"# The root is the app; clients/ holds the packages made from its API.",
			"packages:",
			'  - "."',
			"  - clients/*",
			"# `pnpm add` in the root adds to the app, as in a Project without clients.",
			"ignoreWorkspaceRootCheck: true",
			"# piece-end: sdk",
			"",
		].join("\n"),
	);

// The template's own lockfile: the root lockfile with apps/app as the only importer, so a project
// installs the versions the release was tested with instead of resolving its ranges fresh, which
// minimumReleaseAge can refuse on the day a dependency ships. The workspace links are dropped and
// resolve from npm, exempt from the age check; the first install prunes what apps/app never used.
export const lockfileRender = (rootLockfile: string): string => {
	// pnpm writes its own install in a first YAML document; the dependencies are in the last.
	const documents = rootLockfile.split(/^(?=---\n)/m);
	const last = documents.at(-1) ?? "";
	const app = /^ {2}apps\/app:\n((?: {4}.*\n)+)/m.exec(last)?.[1];
	const importers = /^importers:\n\n[\s\S]*?\n(?=packages:\n)/m;
	if (app === undefined || !importers.test(last)) {
		throw new Error("the root lockfile has no apps/app importer");
	}
	const dependencies = app.replace(
		/^ {6}\S.*:\n {8}specifier: .*\n {8}version: link:.*\n/gm,
		"",
	);
	const own = last.replace(importers, `importers:\n\n  .:\n${dependencies}\n`);
	return [...documents.slice(0, -1), own].join("");
};

// A manifest under clients/ with its `workspace:^` ranges on our own packages as `pnpm pack` writes
// them, `^` and the version in `versions`; a Project installs those packages from npm.
export const clientManifestPin = (
	text: string,
	versions: Record<string, string>,
): string => {
	const manifest = JSON.parse(text) as Partial<
		Record<"dependencies" | "devDependencies", Record<string, string>>
	>;
	for (const field of ["dependencies", "devDependencies"] as const) {
		for (const [name, range] of Object.entries(manifest[field] ?? {})) {
			if (
				!name.startsWith("@n8io/baseline-") ||
				!range.startsWith("workspace:")
			) {
				continue;
			}
			const version = versions[name];
			if (version === undefined) throw new Error(`no package is ${name}`);
			if (range !== "workspace:^") {
				throw new Error(`${name}: use workspace:^, not ${range}`);
			}
			manifest[field] = { ...manifest[field], [name]: `^${version}` };
		}
	}
	return `${JSON.stringify(manifest, null, "\t")}\n`;
};

// Exports apps/app at `ref` of a baseline checkout: files with `git archive`, package.json from
// `pnpm pack` (workspace:^ becomes a caret range; pnpm pack writes a lockfile, so use a throwaway
// checkout), the clients' manifests from clientManifestPin, pnpm-workspace.yaml from the root and
// pnpm-lock.yaml from lockfileRender. Returns the unrendered files, foo included.
export const templateExport = (
	checkout: string,
	ref: string,
): TemplateFile[] => {
	using work = mkdtempDisposableSync(join(tmpdir(), "template-export-"));
	const app = join(work.path, "app");
	mkdirSync(app);
	const archive = join(work.path, "app.tar");
	run({
		command: "git",
		args: ["archive", "--output", archive, `${ref}:apps/app`],
		options: {
			cwd: checkout,
		},
	});
	run({ command: "tar", args: ["-xf", archive, "-C", app] });
	const packed = join(work.path, "packed");
	mkdirSync(packed);
	run({
		command: "pnpm",
		args: ["pack", "--pack-destination", packed],
		options: {
			cwd: join(checkout, "apps/app"),
		},
	});
	const tarball = readdirSync(packed).find((f) => f.endsWith(".tgz"));
	if (tarball === undefined) throw new Error("pnpm pack wrote no tarball");
	run({
		command: "tar",
		args: ["-xzf", join(packed, tarball), "-C", packed, "package/package.json"],
	});
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
	const versions = Object.fromEntries(
		readdirSync(join(checkout, "packages")).map((folder) => {
			const { name, version } = JSON.parse(
				readFileSync(
					join(checkout, "packages", folder, "package.json"),
					"utf8",
				),
			) as { name: string; version: string };
			return [name, version];
		}),
	);
	const clients = join(app, "clients");
	for (const client of existsSync(clients) ? readdirSync(clients) : []) {
		const path = join(clients, client, "package.json");
		if (existsSync(path)) {
			writeFileSync(
				path,
				clientManifestPin(readFileSync(path, "utf8"), versions),
			);
		}
	}
	writeFileSync(
		join(app, "pnpm-workspace.yaml"),
		workspaceRender(
			readFileSync(join(checkout, "pnpm-workspace.yaml"), "utf8"),
		),
	);
	writeFileSync(
		join(app, "pnpm-lock.yaml"),
		lockfileRender(readFileSync(join(checkout, "pnpm-lock.yaml"), "utf8")),
	);
	return filesRead(app);
};

// Clones the release (blobless) and exports its apps/app, then removes the clone.
export const templateFetch = (version: string): TemplateFile[] => {
	using work = mkdtempDisposableSync(join(tmpdir(), "template-"));
	const clone = join(work.path, "clone");
	run({
		command: "git",
		args: [
			"-c",
			"advice.detachedHead=false",
			"clone",
			"--quiet",
			"--filter=blob:none",
			"--branch",
			releaseTag(version),
			`https://github.com/${templateRepository}.git`,
			clone,
		],
	});
	return templateExport(clone, releaseTag(version));
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
