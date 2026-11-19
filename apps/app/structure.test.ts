import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	agentDocsCommandsMissing,
	agentDocsViolations,
	agentDocsViolationsRead,
} from "./agent-docs-test-rules.ts";
import { pieceMarkersProblems } from "./scripts/piece-remove.ts";

// The files this test reads or runs from disk, so `pnpm test --changed` runs it when one changes.
import.meta.glob(
	[
		"./**",
		"./**/.*",
		"./.*/**",
		"!./.git/**",
		"!./.react-router/**",
		"!**/*.md",
	],
	{ query: "?raw" },
);
import.meta.glob(["./AGENTS.md", "./CONTEXT.md", "./docs/agents/**"], {
	query: "?raw",
});

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
	const byContext = new Map<string, string[]>();
	for (const path of paths) {
		const [, , name, ...rest] = path.split("/");
		if (name)
			byContext.set(name, [...(byContext.get(name) ?? []), rest.join("/")]);
	}
	for (const [name, files] of byContext) {
		const base = `src/contexts/${name}`;
		const allowed = new Set(["index.ts", `${name}-error-status.ts`]);
		const folders = [
			"domain",
			"application",
			"adapters/inbound",
			"adapters/outbound",
		];
		termCheck(name);
		for (const file of ["index.ts", "application/ports.ts"]) {
			if (!files.includes(file)) problems.push(`${base}/${file}: add ${file}`);
		}
		for (const folder of ["domain", "application"]) {
			if (!files.some((f) => f.startsWith(`${folder}/`)))
				problems.push(
					`${base}/${folder}/: add at least one file in ${folder}/`,
				);
		}
		for (const folder of ["adapters/inbound", "adapters/outbound"]) {
			if (
				files.some((f) => f.startsWith(`${folder}/`)) &&
				!files.includes(`${folder}/index.ts`)
			) {
				problems.push(`${base}/${folder}/index.ts: add index.ts to ${folder}/`);
			}
		}
		for (const file of files) {
			const inFolder = folders.some((folder) => file.startsWith(`${folder}/`));
			if (!allowed.has(file) && !inFolder) {
				problems.push(
					`${base}/${file}: a context root holds only index.ts and ${name}-error-status.ts; put the model, its rules, errors and repository ports in domain/, use cases and the other ports in application/, inbound adapters in adapters/inbound/, outbound adapters in adapters/outbound/`,
				);
			}
		}
		// Each model in domain/ is a glossary term. Errors, repository ports and Rules are not; a
		// Rule is the file with a test beside it (one per file, with a test).
		for (const file of files) {
			const stem = /^domain\/([^/]+)\.ts$/.exec(file)?.[1];
			if (
				stem &&
				!stem.endsWith(".test") &&
				!["errors", "repositories"].includes(stem) &&
				!files.includes(`domain/${stem}.test.ts`)
			)
				termCheck(stem);
		}
	}
	return problems;
};

// CI runs `pnpm test --changed`, which runs a unit test only when a file its imports reach changed.
// A test that reads or runs a file of the app by its path declares the file with
// `import.meta.glob([...], { query: "?raw" })`, so a change to it still runs the test, or says it
// reads none. test/integration/ is exempt: CI runs it whole on every code change.
const diskReadsUndeclared = (
	files: { path: string; source: string }[],
): string[] =>
	files
		.filter(
			({ path, source }) =>
				/\.test\.tsx?$/.test(path) &&
				!path.startsWith("test/integration/") &&
				/ from "node:(fs|child_process)(\/promises)?";/.test(source) &&
				!source.includes("import.meta.glob(") &&
				!source.includes("// Reads and runs no file of the app"),
		)
		.map(
			({ path }) =>
				`${path}: declare the files it reads or runs with import.meta.glob([...], { query: "?raw" }), or say "// Reads and runs no file of the app"`,
		);

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

// A test that drops its database with `await using` does it inside the test, and DROP DATABASE forces a
// Postgres checkpoint (6.7 s on one CI runner), so the file must give its tests 60 s, as vitest.config.ts says.
const databaseTimeoutViolations = (
	files: { path: string; source: string }[],
): string[] =>
	files
		.filter(
			({ source }) =>
				/await using\s+\w+\s*=\s*await integrationDatabaseCreate/.test(
					source,
				) && !/describe\([^{}]*\{[^{}]*timeout: 60_000/.test(source),
		)
		.map(
			({ path }) =>
				`${path}: this test drops its database with \`await using\`, which can take over 5 s on a CI runner; give its tests 60 s with \`describe(name, { timeout: 60_000 }, ...)\``,
		);

// AGENTS.md loads every time an agent starts, so it has a size budget. The Template's file stays under 13,000
// bytes, so a Project has at least 1 KB for rules of its own.
const agentsMaxBytes = 14_000;

const context = "**Bar**:\nA thing.\n";
const barBase = [
	"src/contexts/bar/index.ts",
	"src/contexts/bar/application/ports.ts",
	"src/contexts/bar/domain/bar.ts",
	"src/contexts/bar/application/bar-create.ts",
];
const without = (path: string) => barBase.filter((p) => p !== path);

describe("context structure", () => {
	it("holds for the real tree", () => {
		const contexts = new URL("src/contexts/", appRoot);
		const paths = filesList(contexts, "src/contexts");
		const text = readFileSync(new URL("CONTEXT.md", appRoot), "utf8");
		// A rendered project starts with no context, so only the folder must exist.
		expect(existsSync(contexts)).toBe(true);
		expect(structureViolations(paths, text)).toEqual([]);
	});

	it("passes a complete context", () => {
		expect(
			structureViolations(
				[
					...barBase,
					"src/contexts/bar/bar-error-status.ts",
					"src/contexts/bar/domain/errors.ts",
					"src/contexts/bar/domain/repositories.ts",
					"src/contexts/bar/domain/bar-points-total.ts",
					"src/contexts/bar/domain/bar-points-total.test.ts",
					"src/contexts/bar/application/helpers/bar-x.ts",
					"src/contexts/bar/adapters/inbound/index.ts",
					"src/contexts/bar/adapters/outbound/index.ts",
				],
				context,
			),
		).toEqual([]);
	});

	it.each([
		{
			message:
				"src/contexts/bar/application/ports.ts: add application/ports.ts",
			paths: without("src/contexts/bar/application/ports.ts"),
			name: "missing application/ports.ts",
		},
		{
			message: "src/contexts/bar/domain/: add at least one file in domain/",
			paths: without("src/contexts/bar/domain/bar.ts"),
			name: "missing domain/",
		},
		{
			message:
				"src/contexts/bar/adapters/inbound/index.ts: add index.ts to adapters/inbound/",
			paths: [...barBase, "src/contexts/bar/adapters/inbound/bar-routes.ts"],
			name: "adapters/inbound/ without index.ts",
		},
		{
			message:
				"src/contexts/bar/helper.ts: a context root holds only index.ts and bar-error-status.ts",
			paths: [...barBase, "src/contexts/bar/helper.ts"],
			name: "a stray root file",
		},
		{
			message: "src/contexts/bar/helpers/x.ts: a context root holds only",
			paths: [...barBase, "src/contexts/bar/helpers/x.ts"],
			name: "a stray root folder",
		},
		{
			message: "src/contexts/bar/adapters/x.ts: a context root holds only",
			paths: [...barBase, "src/contexts/bar/adapters/x.ts"],
			name: "a file in adapters/ itself",
		},
		{
			message: "CONTEXT.md: add a **Bar line**: term for bar-line",
			paths: [...barBase, "src/contexts/bar/domain/bar-line.ts"],
			name: "a model with no glossary term",
		},
	])("fails on $name", ({ message, paths }) => {
		expect(structureViolations(paths, context)).toEqual([
			expect.stringContaining(message),
		]);
	});

	it("fails on a context with no glossary term", () => {
		expect(structureViolations(barBase, "**Baz**:\n")).toEqual([
			"CONTEXT.md: add a **Bar**: term for bar",
		]);
	});

	it("passes a model once the glossary has its term", () => {
		const paths = [...barBase, "src/contexts/bar/domain/bar-line.ts"];
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
				"src/server-open.test.ts",
				"src/contexts/bar/adapters/outbound/bar-repository.postgres.ts",
				"src/contexts/bar/adapters/outbound/bar-repository.postgres.test.ts",
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

describe("unit tests that read the disk", () => {
	it("hold for the real tree", () => {
		const files = appFilesList(appRoot)
			.filter((path) => /\.test\.tsx?$/.test(path))
			.map((path) => ({
				path,
				source: readFileSync(new URL(path, appRoot), "utf8"),
			}));
		expect(diskReadsUndeclared(files)).toEqual([]);
	});

	it.each([
		[
			"declares its files",
			'import { readFileSync } from "node:fs";\nimport.meta.glob(["./a.json"], { query: "?raw" });\n',
		],
		[
			"says it reads none",
			'import { spawnSync } from "node:child_process";\n// Reads and runs no file of the app, only a temporary folder.\n',
		],
		["reads nothing", 'import { a } from "./a.ts";\n'],
	])("passes a test that %s", (_name, source) => {
		expect(diskReadsUndeclared([{ path: "src/a.test.ts", source }])).toEqual(
			[],
		);
		expect(
			diskReadsUndeclared([
				{
					path: "test/integration/a.test.ts",
					source: 'import { spawn } from "node:child_process";\n',
				},
			]),
		).toEqual([]);
	});

	it.each([
		["node:fs", 'import {\n\treadFileSync,\n} from "node:fs";\n'],
		["node:fs/promises", 'import { readFile } from "node:fs/promises";\n'],
		["node:child_process", 'import { spawn } from "node:child_process";\n'],
	])(
		"fails on a test that imports %s and declares nothing",
		(_name, source) => {
			expect(diskReadsUndeclared([{ path: "src/a.test.ts", source }])).toEqual([
				expect.stringContaining("declare the files it reads or runs"),
			]);
		},
	);
});

describe("integration database timeout", () => {
	const source = (extra: string) =>
		`import { integrationDatabaseCreate } from "./integration-database.ts";\n${extra}`;
	const using =
		"it('x', async () => { await using database = await integrationDatabaseCreate(); });";

	it("holds for the real tree", () => {
		const files = appFilesList(appRoot)
			.filter((path) =>
				/(^src\/.*\.(postgres|redis)\.test\.ts|^test\/integration\/.*\.test\.ts)$/.test(
					path,
				),
			)
			.map((path) => ({
				path,
				source: readFileSync(new URL(path, appRoot), "utf8"),
			}));
		expect(files.length).toBeGreaterThan(10);
		expect(databaseTimeoutViolations(files)).toEqual([]);
	});

	it("passes a file that gives its tests 60 s", () => {
		expect(
			databaseTimeoutViolations([
				{
					path: "a.test.ts",
					source: source(
						`describe("a", { timeout: 60_000 }, () => { ${using} });`,
					),
				},
				{
					path: "b.test.ts",
					source: source(
						`describe("b", { retry: 1, timeout: 60_000 }, () => { ${using} });`,
					),
				},
			]),
		).toEqual([]);
	});

	it("fails a file whose 60 s sits on a hook, not on the describe", () => {
		expect(
			databaseTimeoutViolations([
				{
					path: "c.test.ts",
					source: source(
						`beforeAll(async () => {}, 60_000); describe("c", () => { ${using} });`,
					),
				},
			]),
		).toEqual([expect.stringContaining("give its tests 60 s")]);
	});

	it("fails a file that drops with await using and keeps the default timeout", () => {
		expect(
			databaseTimeoutViolations([
				{
					path: "a.test.ts",
					source: source(`describe("a", () => { ${using} });`),
				},
			]),
		).toEqual([expect.stringContaining("give its tests 60 s")]);
	});
});

describe("agent docs", () => {
	it("holds for the real files", () => {
		expect(
			agentDocsViolationsRead({
				agentsMaxBytes,
				commandRoots: [appRoot],
				root: appRoot,
			}),
		).toEqual([]);
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
			// Two bytes each: the budget counts bytes, not characters.
			docs: [{ path: "AGENTS.md", text: "é".repeat(agentsMaxBytes / 2 + 1) }],
			problem:
				"AGENTS.md: keep it to 14000 bytes; move task-specific rules to docs/agents/",
			name: "an AGENTS.md over its budget",
		},
		{
			docs: [{ path: "AGENTS.md", text: "Glossary: @CONTEXT.md. Read it." }],
			problem:
				"AGENTS.md: put @CONTEXT.md alone on its line, or it is not imported",
			name: "an import inside a sentence",
		},
		{
			docs: [{ path: "AGENTS.md", text: "[x](docs/agents/gone.md)" }],
			problem: "AGENTS.md: links docs/agents/gone.md, which does not exist",
			name: "a link to a missing file",
		},
		{
			docs: [
				{ path: "AGENTS.md", text: "" },
				{ path: "docs/agents/data.md", text: "" },
			],
			problem: "AGENTS.md: link docs/agents/data.md under ## Read when",
			name: "a doc AGENTS.md does not link",
		},
	])("fails on $name", ({ docs, problem }) => {
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

describe("agent docs commands", () => {
	const commands = new Set(["check", "dev", "test:integration"]);

	it("passes scripts and pnpm's own commands, in code only", () => {
		const text = [
			"Run `pnpm check`, `pnpm run dev` or `pnpm test:integration <path>`.",
			"`pnpm install && pnpm exec vitest run` and pnpm from `packageManager`.",
			"`pnpm outdated`, `pnpm why x`, `pnpm --filter app check`.",
			"```sh",
			"# pnpm is pinned in packageManager",
			"source nvm.sh && pnpm check",
			"```",
		].join("\n");
		expect(
			agentDocsCommandsMissing({
				commands,
				docs: [{ path: "AGENTS.md", text }],
			}),
		).toEqual([]);
	});

	it.each([
		["an inline span", "Then `pnpm lint`."],
		["a pnpm run", "Then `pnpm run lint`."],
		["a binary run without exec", "Then `pnpm lint --fix`."],
		["a command after options", "Then `pnpm --filter app -r lint`."],
		["a command after -C", "Then `pnpm -C apps/app lint`."],
		["quotes in code", 'Then `sh -c "pnpm lint"`.'],
		["an indented fence", "1. Run:\n   ```sh\n   pnpm lint\n   ```"],
		["a tilde fence", "~~~sh\npnpm lint\n~~~"],
		["a fenced block", "```sh\ncd app && pnpm lint\n```"],
	])("fails on a missing command in %s", (_name, text) => {
		expect(
			agentDocsCommandsMissing({
				commands,
				docs: [{ path: "docs/agents/x.md", text }],
			}),
		).toEqual([
			"docs/agents/x.md: names pnpm lint, which is no script in package.json and no pnpm command (run a binary with pnpm exec)",
		]);
	});
});

// Every `docker compose` command names its project with `-p`, so two Projects on one machine never
// replace each other's containers, and runs under `varlock run` so it sees the Project's host ports.
describe("docker compose commands", () => {
	const manifest = JSON.parse(
		readFileSync(new URL("package.json", appRoot), "utf8"),
	) as { name: string; scripts: Record<string, string> };
	const composeCommands = (text: string): string[] =>
		[...text.matchAll(/docker compose [^&|)`"\n]*/g)].map((m) => m[0]);

	it("hold in package.json scripts, docs/agents/deploy.md and compose.yaml", () => {
		const texts = [
			...Object.values(manifest.scripts),
			readFileSync(new URL("docs/agents/deploy.md", appRoot), "utf8"),
			readFileSync(new URL("compose.yaml", appRoot), "utf8"),
		];
		const bad = texts
			.flatMap(composeCommands)
			.filter((command) => !/^docker compose -p \S+/.test(command));
		expect(bad).toEqual([]);
	});

	it("run under varlock in package.json scripts", () => {
		const bad = Object.entries(manifest.scripts).filter(
			([, script]) =>
				script.includes("docker compose") &&
				!script.includes("varlock run -- docker compose"),
		);
		expect(bad).toEqual([]);
	});

	it("name the same project in compose.yaml", () => {
		const compose = readFileSync(new URL("compose.yaml", appRoot), "utf8");
		expect(/^name: (.+)$/m.exec(compose)?.[1]).toBe(manifest.name);
	});
});

// piece-remove cuts from a piece's start line to its end line, so a start without its end, or two
// blocks that cross (Biome's import and export sorting can do that), deletes the wrong code.
describe("piece markers", () => {
	const skipped = new Set([".git", ".react-router", "build", "node_modules"]);
	const textFilesList = (dir: URL, prefix = ""): string[] =>
		readdirSync(dir, { withFileTypes: true })
			.filter((entry) => !skipped.has(entry.name))
			.flatMap((entry) =>
				entry.isDirectory()
					? textFilesList(
							new URL(`${entry.name}/`, dir),
							`${prefix}${entry.name}/`,
						)
					: entry.name.endsWith(".md") || entry.name === "pnpm-lock.yaml"
						? []
						: [`${prefix}${entry.name}`],
			);
	const mark = (edge: "end" | "start", piece: string) =>
		`// piece-${edge}: ${piece}`;

	it("balance in every file of the app", () => {
		const bad = textFilesList(appRoot).flatMap((path) =>
			pieceMarkersProblems(readFileSync(new URL(path, appRoot), "utf8")).map(
				(problem) => `${path}: ${problem}`,
			),
		);
		expect(bad).toEqual([]);
	});

	it("pass blocks that nest and blocks that follow each other", () => {
		const text = [
			mark("start", "queue"),
			mark("start", "redis"),
			mark("end", "redis"),
			mark("end", "queue"),
			mark("start", "live"),
			mark("end", "live"),
		].join("\n");
		expect(pieceMarkersProblems(text)).toEqual([]);
	});

	it.each([
		["a block with no end", [mark("start", "live"), "code"]],
		["an end with no start", ["code", mark("end", "live")]],
		[
			"blocks that cross",
			[
				mark("start", "live"),
				mark("start", "queue"),
				mark("end", "live"),
				mark("end", "queue"),
			],
		],
	])("fail on %s", (_name, lines) => {
		expect(pieceMarkersProblems(lines.join("\n"))).not.toEqual([]);
	});
});
