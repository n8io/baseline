import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appRoot = new URL("./", import.meta.url);

const termOf = (name: string) => {
	const [first = "", ...rest] = name.split("-");
	return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
};

const structureViolations = (paths: string[], context: string): string[] => {
	const problems: string[] = [];
	const terms = new Set(
		[...context.matchAll(/^\*\*(.+?)\*\*:/gm)].map((m) =>
			(m[1] ?? "").toLowerCase(),
		),
	);
	const termCheck = (name: string) => {
		const message = `CONTEXT.md: add a **${termOf(name)}**: term for ${name}`;
		if (!terms.has(termOf(name).toLowerCase()) && !problems.includes(message))
			problems.push(message);
	};
	const byDomain = new Map<string, string[]>();
	for (const path of paths) {
		const [, , name, ...rest] = path.split("/");
		if (name)
			byDomain.set(name, [...(byDomain.get(name) ?? []), rest.join("/")]);
	}
	for (const [name, files] of byDomain) {
		const base = `src/domains/${name}`;
		const allowed = new Set(["index.ts", "ports.ts", `${name}-errors.ts`]);
		const folders = ["models", "use-cases", "rules", "api", "spi"];
		termCheck(name);
		for (const file of ["index.ts", "ports.ts"]) {
			if (!files.includes(file)) problems.push(`${base}/${file}: add ${file}`);
		}
		for (const folder of ["models", "use-cases"]) {
			if (!files.some((f) => f.startsWith(`${folder}/`)))
				problems.push(
					`${base}/${folder}/: add at least one file in ${folder}/`,
				);
		}
		for (const folder of ["api", "spi"]) {
			if (
				files.some((f) => f.startsWith(`${folder}/`)) &&
				!files.includes(`${folder}/index.ts`)
			) {
				problems.push(`${base}/${folder}/index.ts: add index.ts to ${folder}/`);
			}
		}
		for (const file of files) {
			const top = file.split("/")[0] ?? "";
			if (!allowed.has(file) && !folders.includes(top)) {
				problems.push(
					`${base}/${file}: a domain root holds only index.ts, ports.ts and ${name}-errors.ts; put models in models/, rules in rules/, use cases in use-cases/, inbound adapters in api/, outbound adapters in spi/`,
				);
			}
		}
		for (const file of files) {
			const match = /^models\/([^/]+)\.ts$/.exec(file);
			if (match?.[1] && !match[1].endsWith(".test")) termCheck(match[1]);
		}
	}
	return problems;
};

// A test sits beside the file it covers (<name>.test.ts or <name>-<aspect>.test.ts) in src/ or
// scripts/, at the app root when it checks the whole app, or in test/integration/.
const testPlacementViolations = (paths: string[]): string[] => {
	const folderOf = (path: string) => path.slice(0, path.lastIndexOf("/") + 1);
	const nameOf = (path: string) => path.slice(folderOf(path).length);
	const sources = paths.filter((path) => !path.endsWith(".test.ts"));
	return paths
		.filter((path) => path.endsWith(".test.ts"))
		.filter((path) => {
			if (!path.includes("/") || path.startsWith("test/integration/"))
				return false;
			const name = nameOf(path).slice(0, -".test.ts".length);
			const beside = sources.some((source) => {
				const stem = nameOf(source).replace(/\.[^.]+$/, "");
				return (
					folderOf(source) === folderOf(path) &&
					(name === stem ||
						name.startsWith(`${stem}-`) ||
						name.startsWith(`${stem}.`))
				);
			});
			return !(beside && /^(src|scripts)\//.test(path));
		})
		.map(
			(path) =>
				`${path}: put a test beside the file it covers as <name>.test.ts, at the app root when it checks the whole app, or in test/integration/ when it boots a process or spans many modules`,
		);
};

// Every file in the app, except dependencies, build output and dotfiles.
const appFilesList = (dir: URL, prefix = ""): string[] =>
	readdirSync(dir, { withFileTypes: true })
		.filter(
			(entry) =>
				!entry.name.startsWith(".") &&
				!["build", "node_modules"].includes(entry.name),
		)
		.flatMap((entry) =>
			entry.isDirectory()
				? appFilesList(
						new URL(`${entry.name}/`, dir),
						`${prefix}${entry.name}/`,
					)
				: [`${prefix}${entry.name}`],
		);

const filesList = (dir: URL, prefix: string) =>
	readdirSync(dir, { encoding: "utf8", recursive: true })
		// Dotfiles (.DS_Store) are the OS's, not the project's.
		.filter((name) => !/(^|\/)\./.test(name))
		.filter((name) => statSync(new URL(name, dir)).isFile())
		.map((name) => `${prefix}/${name}`);

// AGENTS.md loads on every task, so it stays short and links the rest. Each file it or a doc in
// docs/agents/ links to must exist, and each docs/agents/ file must be linked from AGENTS.md.
const agentsMaxLines = 200;

const agentDocsViolations = (
	docs: { path: string; text: string }[],
	exists: (path: string) => boolean,
): string[] => {
	const problems: string[] = [];
	const agents = docs.find((d) => d.path === "AGENTS.md");
	if (agents && agents.text.split("\n").length > agentsMaxLines)
		problems.push(
			`AGENTS.md: keep it under ${agentsMaxLines} lines; move task-specific rules to docs/agents/`,
		);
	for (const { path, text } of docs) {
		const dir = path.includes("/")
			? path.slice(0, path.lastIndexOf("/") + 1)
			: "";
		for (const [, target = ""] of text.matchAll(
			/\]\(([^)#\s]+\.md)(#[^)]*)?\)/g,
		)) {
			if (/^[a-z]+:/.test(target)) continue;
			const resolved = new URL(target, `file:///${dir}`).pathname.slice(1);
			if (!exists(resolved))
				problems.push(`${path}: links ${target}, which does not exist`);
		}
	}
	for (const { path } of docs.filter((d) => d.path.startsWith("docs/agents/")))
		if (!agents?.text.includes(`](${path})`))
			problems.push(`AGENTS.md: link ${path} under ## Read when`);
	return problems;
};

const context = "**Bar**:\nA thing.\n";
const barBase = [
	"src/domains/bar/index.ts",
	"src/domains/bar/ports.ts",
	"src/domains/bar/models/bar.ts",
	"src/domains/bar/use-cases/bar-create.ts",
];
const without = (path: string) => barBase.filter((p) => p !== path);

describe("domain structure", () => {
	it("holds for the real tree", () => {
		const domains = new URL("src/domains/", appRoot);
		const paths = filesList(domains, "src/domains");
		const text = readFileSync(new URL("CONTEXT.md", appRoot), "utf8");
		// A rendered project starts with no domain, so only the folder must exist.
		expect(existsSync(domains)).toBe(true);
		expect(structureViolations(paths, text)).toEqual([]);
	});

	it("passes a complete domain", () => {
		expect(
			structureViolations(
				[...barBase, "src/domains/bar/api/index.ts"],
				context,
			),
		).toEqual([]);
	});

	it.each([
		[
			"missing ports.ts",
			without("src/domains/bar/ports.ts"),
			"src/domains/bar/ports.ts: add ports.ts",
		],
		[
			"missing use-cases/",
			without("src/domains/bar/use-cases/bar-create.ts"),
			"src/domains/bar/use-cases/: add at least one file in use-cases/",
		],
		[
			"api/ without index.ts",
			[...barBase, "src/domains/bar/api/bar-routes.ts"],
			"src/domains/bar/api/index.ts: add index.ts to api/",
		],
		[
			"a stray root file",
			[...barBase, "src/domains/bar/helper.ts"],
			"src/domains/bar/helper.ts: a domain root holds only index.ts, ports.ts and bar-errors.ts",
		],
		[
			"a stray root folder",
			[...barBase, "src/domains/bar/helpers/x.ts"],
			"src/domains/bar/helpers/x.ts: a domain root holds only",
		],
		[
			"a model with no glossary term",
			[...barBase, "src/domains/bar/models/bar-line.ts"],
			"CONTEXT.md: add a **Bar line**: term for bar-line",
		],
	])("fails on %s", (_name, paths, message) => {
		expect(structureViolations(paths, context)).toEqual([
			expect.stringContaining(message),
		]);
	});

	it("fails on a domain with no glossary term", () => {
		expect(structureViolations(barBase, "**Baz**:\n")).toEqual([
			"CONTEXT.md: add a **Bar**: term for bar",
		]);
	});

	it("passes a model once the glossary has its term", () => {
		const paths = [...barBase, "src/domains/bar/models/bar-line.ts"];
		expect(structureViolations(paths, `${context}**Bar line**:\n`)).toEqual([]);
	});
});

describe("test placement", () => {
	it("holds for the real tree", () => {
		expect(testPlacementViolations(appFilesList(appRoot))).toEqual([]);
	});

	it("passes a test beside its source, a whole-app check and a process-level test", () => {
		expect(
			testPlacementViolations([
				"src/env.ts",
				"src/env.test.ts",
				"src/server.ts",
				"src/server-wiring.test.ts",
				"src/domains/bar/spi/bar-repository.postgres.ts",
				"src/domains/bar/spi/bar-repository.postgres.test.ts",
				"scripts/glossary-check.ts",
				"scripts/glossary-check.test.ts",
				"structure.test.ts",
				"test/integration/ssr.test.ts",
			]),
		).toEqual([]);
	});

	it.each([
		["a test with no source beside it", ["src/env.ts", "src/seed.test.ts"]],
		[
			"a test whose name only starts like a source",
			["src/server.ts", "src/serverless.test.ts"],
		],
		["a test in test/unit/", ["src/seed.ts", "test/unit/seed.test.ts"]],
		["a test in another folder", ["docs/a.ts", "docs/a.test.ts"]],
	])("fails on %s", (_name, paths) => {
		expect(testPlacementViolations(paths)).toEqual([
			expect.stringContaining("put a test beside the file it covers"),
		]);
	});
});

describe("agent docs", () => {
	const read = (path: string) => ({
		path,
		text: readFileSync(new URL(path, appRoot), "utf8"),
	});
	const exists = (path: string) => existsSync(new URL(path, appRoot));

	it("holds for the real files", () => {
		const docs = existsSync(new URL("docs/agents/", appRoot))
			? filesList(new URL("docs/agents/", appRoot), "docs/agents")
			: [];
		expect(
			agentDocsViolations([read("AGENTS.md"), ...docs.map(read)], exists),
		).toEqual([]);
	});

	it.each([
		[
			"an AGENTS.md over the line budget",
			[{ path: "AGENTS.md", text: "line\n".repeat(agentsMaxLines) }],
			"AGENTS.md: keep it under 200 lines; move task-specific rules to docs/agents/",
		],
		[
			"a link to a missing file",
			[{ path: "AGENTS.md", text: "[x](docs/agents/gone.md)" }],
			"AGENTS.md: links docs/agents/gone.md, which does not exist",
		],
		[
			"a doc AGENTS.md does not link",
			[
				{ path: "AGENTS.md", text: "" },
				{ path: "docs/agents/data.md", text: "" },
			],
			"AGENTS.md: link docs/agents/data.md under ## Read when",
		],
	])("fails on %s", (_name, docs, problem) => {
		expect(agentDocsViolations(docs, () => false)).toEqual([problem]);
	});

	it("resolves a link relative to the doc that holds it", () => {
		expect(
			agentDocsViolations(
				[
					{ path: "AGENTS.md", text: "[d](docs/agents/data.md)" },
					{ path: "docs/agents/data.md", text: "[t](tracing.md#spans)" },
				],
				(path) =>
					["docs/agents/data.md", "docs/agents/tracing.md"].includes(path),
			),
		).toEqual([]);
	});
});
