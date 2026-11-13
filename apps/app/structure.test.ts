import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	agentDocsViolations,
	agentDocsViolationsRead,
} from "./agent-docs-test-rules.ts";

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

// AGENTS.md loads on every task, so it has a size budget. Today's file leaves a Project about
// 3 KB for rules of its own.
const agentsMaxBytes = 14_000;

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
		{
			message: "src/domains/bar/ports.ts: add ports.ts",
			paths: without("src/domains/bar/ports.ts"),
			row0: "missing ports.ts",
		},
		{
			message:
				"src/domains/bar/use-cases/: add at least one file in use-cases/",
			paths: without("src/domains/bar/use-cases/bar-create.ts"),
			row0: "missing use-cases/",
		},
		{
			message: "src/domains/bar/api/index.ts: add index.ts to api/",
			paths: [...barBase, "src/domains/bar/api/bar-routes.ts"],
			row0: "api/ without index.ts",
		},
		{
			message:
				"src/domains/bar/helper.ts: a domain root holds only index.ts, ports.ts and bar-errors.ts",
			paths: [...barBase, "src/domains/bar/helper.ts"],
			row0: "a stray root file",
		},
		{
			message: "src/domains/bar/helpers/x.ts: a domain root holds only",
			paths: [...barBase, "src/domains/bar/helpers/x.ts"],
			row0: "a stray root folder",
		},
		{
			message: "CONTEXT.md: add a **Bar line**: term for bar-line",
			paths: [...barBase, "src/domains/bar/models/bar-line.ts"],
			row0: "a model with no glossary term",
		},
	])("fails on $row0", ({ message, paths }) => {
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
	it("holds for the real files", () => {
		expect(agentDocsViolationsRead(appRoot, agentsMaxBytes)).toEqual([]);
	});

	it("allows an AGENTS.md of exactly the budget", () => {
		const text = "x".repeat(agentsMaxBytes);
		expect(
			agentDocsViolations({
				docs: [{ path: "AGENTS.md", text }],
				exists: () => true,
				agentsMaxBytes,
			}),
		).toEqual([]);
	});

	it.each([
		{
			docs: [{ path: "AGENTS.md", text: "é".repeat(agentsMaxBytes / 2 + 1) }], // Two bytes each: the budget counts bytes, not characters.
			problem:
				"AGENTS.md: keep it to 14000 bytes; move task-specific rules to docs/agents/",
			row0: "an AGENTS.md over its budget",
		},
		{
			docs: [{ path: "AGENTS.md", text: "Glossary: @CONTEXT.md. Read it." }],
			problem:
				"AGENTS.md: put @CONTEXT.md alone on its line, or it is not imported",
			row0: "an import inside a sentence",
		},
		{
			docs: [{ path: "AGENTS.md", text: "[x](docs/agents/gone.md)" }],
			problem: "AGENTS.md: links docs/agents/gone.md, which does not exist",
			row0: "a link to a missing file",
		},
		{
			docs: [
				{ path: "AGENTS.md", text: "" },
				{ path: "docs/agents/data.md", text: "" },
			],
			problem: "AGENTS.md: link docs/agents/data.md under ## Read when",
			row0: "a doc AGENTS.md does not link",
		},
	])("fails on $row0", ({ docs, problem }) => {
		expect(
			agentDocsViolations({
				docs,
				exists: (path) => path === "CONTEXT.md",
				agentsMaxBytes,
			}),
		).toEqual([problem]);
	});

	it("fails on an import of a missing file", () => {
		expect(
			agentDocsViolations({
				docs: [{ path: "AGENTS.md", text: "@GONE.md" }],
				exists: () => false,
				agentsMaxBytes,
			}),
		).toEqual(["AGENTS.md: imports GONE.md, which does not exist"]);
	});

	it("takes an import alone on its line, also as ./<path>", () => {
		expect(
			agentDocsViolations({
				docs: [
					{ path: "AGENTS.md", text: "# App\n\n@CONTEXT.md\n@./CONTEXT.md\n" },
				],
				exists: (path) => path === "CONTEXT.md",
				agentsMaxBytes,
			}),
		).toEqual([]);
	});

	it("takes a package name, an email and code as no import", () => {
		const text = [
			"@n8io/baseline-cache a@b.md `use @GONE.md here`",
			"```",
			"@GONE.md",
			"```",
		].join("\n");
		expect(
			agentDocsViolations({
				docs: [{ path: "AGENTS.md", text }],
				exists: () => false,
				agentsMaxBytes,
			}),
		).toEqual([]);
	});

	it("resolves a link relative to the doc that holds it", () => {
		expect(
			agentDocsViolations({
				docs: [
					{ path: "AGENTS.md", text: "[d](docs/agents/data.md)" },
					{ path: "docs/agents/data.md", text: "[t](tracing.md#spans)" },
				],
				exists: (path) =>
					["docs/agents/data.md", "docs/agents/tracing.md"].includes(path),
				agentsMaxBytes,
			}),
		).toEqual([]);
	});
});
