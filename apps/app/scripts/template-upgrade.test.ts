import { execFileSync } from "node:child_process";
import { once } from "node:events";
import {
	type DisposableTempDir,
	existsSync,
	mkdtempDisposableSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { npmTarballsWait } from "./npm-tarballs-wait.ts";
import { gitRun } from "./process-run.ts";
import { filesWrite, type TemplateFile } from "./template-render.ts";
import {
	changelogBetween,
	droppedImportsFind,
	languageKeep,
	secretKeep,
	templateUpgradeRun,
	type UpgradeTools,
	workspaceExcludesDedupe,
} from "./template-upgrade.ts";

// Reads and runs no file of the app, only its imports and a temporary folder.

// What the run says and which package scripts it runs, in place of the console and pnpm.
const runCapture = () => {
	const errors: string[] = [];
	const logs: string[] = [];
	const scripts: string[] = [];
	return {
		errors,
		logs,
		output: {
			error: (line: string) => errors.push(line),
			log: (line: string) => logs.push(line),
		},
		pnpm: (args: string[]) => scripts.push(args.join(" ")),
		scripts,
		tarballsWait: async () => {
			scripts.push("wait");
		},
	};
};

// A Project that kept every piece.
const piecePackages = {
	"@n8io/baseline-analytics": "1.0.0",
	"@n8io/baseline-cache": "1.0.0",
	"@n8io/baseline-error-tracking": "1.0.0",
	"@n8io/baseline-live": "1.0.0",
	"@n8io/baseline-queue": "1.0.0",
	"@n8io/baseline-redis": "1.0.0",
	"react-router": "1.0.0",
};

const manifest = `${JSON.stringify({ dependencies: piecePackages, name: "invoicing" }, null, "\t")}\n`;
const releaseManifest = JSON.stringify({
	dependencies: piecePackages,
	name: "app",
});
const lockfile = "biome: 2.6.5\nzod: 4.6.7\n";
const releases: Record<string, TemplateFile[]> = {
	"1.0.0": [
		{ path: "CONTEXT.md", text: "# Template.\n" },
		{ path: "package.json", text: releaseManifest },
		{ path: "pnpm-lock.yaml", text: "biome: 2.6.5\n" },
		{ path: "src/a.ts", text: "one\ntwo\nthree\nfour\nfive\n" },
	],
	"1.1.0": [
		{
			path: "CHANGELOG.md",
			text: "# app\n\n## 1.1.0\n\n- Four is 4.\n\n## 1.0.0\n\n- First.\n",
		},
		{ path: "CONTEXT.md", text: "# Template.\n" },
		{ path: "package.json", text: releaseManifest },
		{ path: "pnpm-lock.yaml", text: "biome: 2.6.7\n" },
		{ path: "src/a.ts", text: "one\ntwo\nthree\n4\nfive\n" },
		{ path: "src/b.ts", text: "new\n" },
	],
};
const tools: UpgradeTools = {
	fetch: (version) => releases[version] ?? [],
	finish: () => {},
};

// A project rendered from 1.0.0 and committed, with `a.ts` as the project left it.
const projectCreate = (a: string): DisposableTempDir => {
	const folder = mkdtempDisposableSync(join(tmpdir(), "template-upgrade-"));
	const app = folder.path;
	gitRun(app, ["init", "--quiet", "--initial-branch=main"]);
	gitRun(app, ["config", "user.email", "test@example.com"]);
	gitRun(app, ["config", "user.name", "Test"]);
	const files: Record<string, string> = {
		".template.json": '{ "release": "1.0.0", "description": "Invoices." }\n',
		"CONTEXT.md": "# Invoices.\n",
		"package.json": manifest,
		"pnpm-lock.yaml": lockfile,
		"src/a.ts": a,
		"src/contexts/.gitkeep": "",
	};
	for (const [path, text] of Object.entries(files)) {
		execFileSync("mkdir", ["-p", join(app, path, "..")]);
		writeFileSync(join(app, path), text);
	}
	gitRun(app, ["add", "."]);
	gitRun(app, ["commit", "--quiet", "-m", "project"]);
	return folder;
};

describe("droppedImportsFind", () => {
	const manifestOf = (names: string[]) =>
		JSON.stringify({
			dependencies: Object.fromEntries(names.map((name) => [name, "^1.0.0"])),
		});
	const files = [
		{
			path: "src/a.tsx",
			text: 'import { a } from "@scope/pack/sub";\nconst b = await import("gone");\nimport "./local.ts";\nimport "#env";\nimport fs from "node:fs";\n',
		},
		{ path: "docs/x.ts", text: 'import "gone";\n' },
	];

	it("names each dropped package that code under src, test, scripts or clients still imports", () => {
		expect(
			droppedImportsFind({
				before: manifestOf(["@scope/pack", "gone", "kept", "unused"]),
				after: manifestOf(["kept"]),
				files,
			}),
		).toEqual([
			{ name: "@scope/pack", paths: ["src/a.tsx"], range: "^1.0.0" },
			{ name: "gone", paths: ["src/a.tsx"], range: "^1.0.0" },
		]);
	});

	it("finds nothing when no import loses its dependency", () => {
		expect(
			droppedImportsFind({
				before: manifestOf(["gone"]),
				after: manifestOf(["gone"]),
				files,
			}),
		).toEqual([]);
	});
});

describe("templateUpgradeRun", () => {
	it("merges the template's change into the project's own edits, without committing", async () => {
		using folder = projectCreate("ONE\ntwo\nthree\nfour\nfive\n");
		const app = folder.path;
		const run = runCapture();

		expect(
			await templateUpgradeRun({
				appDirectory: app,
				to: "1.1.0",
				tools,
				...run,
			}),
		).toBe(0);
		expect(readFileSync(join(app, "src/a.ts"), "utf8")).toBe(
			"ONE\ntwo\nthree\n4\nfive\n",
		);
		expect(readFileSync(join(app, "src/b.ts"), "utf8")).toBe("new\n");
		expect(readFileSync(join(app, "package.json"), "utf8")).toBe(manifest);
		expect(readFileSync(join(app, "pnpm-lock.yaml"), "utf8")).toBe(lockfile);
		expect(
			JSON.parse(readFileSync(join(app, ".template.json"), "utf8")).release,
		).toBe("1.1.0");
		expect(gitRun(app, ["rev-list", "--count", "HEAD"]).trim()).toBe("1");
		expect(run.scripts).toEqual([
			"install --lockfile-only",
			"wait",
			"install",
			"format",
			"check",
			"test",
		]);
		expect(run.logs.join("\n")).toContain("- Four is 4.");
	});

	it("brings no removed piece back: not its package, its file or its blocks", async () => {
		const manifestOf = (analytics: boolean) =>
			`${JSON.stringify(
				{
					dependencies: analytics
						? piecePackages
						: {
								...piecePackages,
								"@n8io/baseline-analytics": undefined,
								"@n8io/baseline-redis": undefined,
							},
					name: "app",
				},
				null,
				"\t",
			)}\n`;
		const blocks = (changed: string) =>
			`import a from "a";\n// piece-start: analytics\nanalyticsOpen();\n// piece-end: analytics\n${changed}\n`;
		const release = (changed: string): TemplateFile[] => [
			{ path: "package.json", text: manifestOf(true) },
			{ path: "src/analytics-open.ts", text: "export {};\n" },
			{ path: "src/redis-open.ts", text: "export {};\n" },
			{ path: "src/a.ts", text: blocks(changed) },
		];
		const pieces: Record<string, TemplateFile[]> = {
			"2.0.0": release("old"),
			"2.1.0": release("new"),
		};
		using folder = mkdtempDisposableSync(join(tmpdir(), "template-upgrade-"));
		const app = folder.path;
		gitRun(app, ["init", "--quiet", "--initial-branch=main"]);
		gitRun(app, ["config", "user.email", "test@example.com"]);
		gitRun(app, ["config", "user.name", "Test"]);
		execFileSync("mkdir", ["-p", join(app, "src")]);
		writeFileSync(
			join(app, ".template.json"),
			'{ "release": "2.0.0", "description": "Invoices." }\n',
		);
		writeFileSync(join(app, "package.json"), manifestOf(false));
		writeFileSync(join(app, "src/a.ts"), 'import a from "a";\nold\n');
		gitRun(app, ["add", "."]);
		gitRun(app, ["commit", "--quiet", "-m", "project"]);

		expect(
			await templateUpgradeRun({
				appDirectory: app,
				to: "2.1.0",
				...runCapture(),
				tools: { fetch: (v) => pieces[v] ?? [], finish: () => {} },
			}),
		).toBe(0);
		expect(readFileSync(join(app, "package.json"), "utf8")).toBe(
			manifestOf(false),
		);
		expect(existsSync(join(app, "src/analytics-open.ts"))).toBe(false);
		expect(existsSync(join(app, "src/redis-open.ts"))).toBe(false);
		expect(readFileSync(join(app, "src/a.ts"), "utf8")).toBe(
			'import a from "a";\nnew\n',
		);
	});

	it("brings a piece new in the target release, and keeps the SDK files the Project generated", async () => {
		const manifestOf = (sdk: boolean) =>
			`${JSON.stringify(
				{
					dependencies: piecePackages,
					...(sdk ? { devDependencies: { orval: "8.48.0" } } : {}),
					name: "app",
				},
				null,
				"\t",
			)}\n`;
		const sdkFiles = (title: string): TemplateFile[] => [
			{
				path: "clients/sdk/openapi.json",
				text: `{"info":{"title":"app","version":"${title}"},"paths":{}}`,
			},
			{ path: "scripts/sdk-generate.ts", text: `// ${title}\n` },
		];
		const pieces: Record<string, TemplateFile[]> = {
			"3.0.0": [{ path: "package.json", text: manifestOf(false) }],
			"3.1.0": [
				{ path: "package.json", text: manifestOf(true) },
				...sdkFiles("3.1"),
			],
			"3.2.0": [
				{ path: "package.json", text: manifestOf(true) },
				...sdkFiles("3.2"),
			],
		};
		using folder = mkdtempDisposableSync(join(tmpdir(), "template-upgrade-"));
		const app = folder.path;
		gitRun(app, ["init", "--quiet", "--initial-branch=main"]);
		gitRun(app, ["config", "user.email", "test@example.com"]);
		gitRun(app, ["config", "user.name", "Test"]);
		const release = (version: string) =>
			writeFileSync(
				join(app, ".template.json"),
				`{ "release": "${version}", "description": "Invoices." }\n`,
			);
		release("3.0.0");
		writeFileSync(join(app, "package.json"), manifestOf(false));
		gitRun(app, ["add", "."]);
		gitRun(app, ["commit", "--quiet", "-m", "project"]);
		const upgrade = (to: string) =>
			templateUpgradeRun({
				appDirectory: app,
				to,
				...runCapture(),
				tools: { fetch: (v) => pieces[v] ?? [], finish: () => {} },
			});

		expect(await upgrade("3.1.0")).toBe(0);
		expect(readFileSync(join(app, "scripts/sdk-generate.ts"), "utf8")).toBe(
			"// 3.1\n",
		);
		expect(readFileSync(join(app, "package.json"), "utf8")).toContain(
			'"orval"',
		);

		// The Project regenerates its SDK; the next upgrade leaves the generated file alone.
		writeFileSync(join(app, "clients/sdk/openapi.json"), '{"title":"own"}\n');
		gitRun(app, ["add", "."]);
		gitRun(app, ["commit", "--quiet", "-m", "upgrade"]);
		expect(await upgrade("3.2.0")).toBe(0);
		expect(readFileSync(join(app, "clients/sdk/openapi.json"), "utf8")).toBe(
			'{"title":"own"}\n',
		);
		expect(readFileSync(join(app, "scripts/sdk-generate.ts"), "utf8")).toBe(
			"// 3.2\n",
		);
	});

	it("brings the cli to a Project with the SDK, and keeps it out of one that removed the SDK", async () => {
		const manifestOf = (sdk: boolean) =>
			`${JSON.stringify(
				{
					dependencies: piecePackages,
					...(sdk ? { devDependencies: { orval: "8.48.0" } } : {}),
					name: "app",
				},
				null,
				"\t",
			)}\n`;
		const sdkFile = { path: "clients/sdk/index.ts", text: "// sdk\n" };
		const cliFile = { path: "clients/cli/package.json", text: "{}\n" };
		const pieces: Record<string, TemplateFile[]> = {
			"4.0.0": [{ path: "package.json", text: manifestOf(true) }, sdkFile],
			"4.1.0": [
				{ path: "package.json", text: manifestOf(true) },
				sdkFile,
				cliFile,
			],
		};
		const upgraded = async (sdk: boolean) => {
			const folder = mkdtempDisposableSync(join(tmpdir(), "template-upgrade-"));
			const app = folder.path;
			gitRun(app, ["init", "--quiet", "--initial-branch=main"]);
			gitRun(app, ["config", "user.email", "test@example.com"]);
			gitRun(app, ["config", "user.name", "Test"]);
			writeFileSync(
				join(app, ".template.json"),
				'{ "release": "4.0.0", "description": "Invoices." }\n',
			);
			writeFileSync(join(app, "package.json"), manifestOf(sdk));
			if (sdk) filesWrite(app, [sdkFile]);
			gitRun(app, ["add", "."]);
			gitRun(app, ["commit", "--quiet", "-m", "project"]);
			expect(
				await templateUpgradeRun({
					appDirectory: app,
					to: "4.1.0",
					...runCapture(),
					tools: { fetch: (v) => pieces[v] ?? [], finish: () => {} },
				}),
			).toBe(0);
			return folder;
		};

		using withSdk = await upgraded(true);
		expect(existsSync(join(withSdk.path, "clients/cli/package.json"))).toBe(
			true,
		);
		using withoutSdk = await upgraded(false);
		expect(existsSync(join(withoutSdk.path, "clients/cli"))).toBe(false);
	});

	it("exits before the checks when the project is already on the target release", async () => {
		using folder = projectCreate("one\ntwo\nthree\nfour\nfive\n");
		const app = folder.path;
		const run = runCapture();

		expect(
			await templateUpgradeRun({
				appDirectory: app,
				to: "1.0.0",
				tools,
				...run,
			}),
		).toBe(0);
		expect(run.logs.join("\n")).toContain(
			"already on release 1.0.0; nothing to upgrade",
		);
		expect(run.scripts).toEqual([]);
		expect(gitRun(app, ["status", "--porcelain"])).toBe("");
	});

	it("leaves conflict markers and exits 1 when both sides changed the same line", async () => {
		using folder = projectCreate("one\ntwo\nthree\nFOUR\nfive\n");
		const app = folder.path;
		const run = runCapture();

		expect(
			await templateUpgradeRun({
				appDirectory: app,
				to: "1.1.0",
				tools,
				...run,
			}),
		).toBe(1);
		expect(readFileSync(join(app, "src/a.ts"), "utf8")).toMatch(
			/<<<<<<< [^\n]*\nFOUR\n=======\n4\n>>>>>>> /,
		);
		expect(run.errors.join("\n")).toContain("conflicts in src/a.ts");
		expect(run.errors.join("\n")).toContain("The merge is left staged");
		expect(run.errors.join("\n")).toContain("then commit");
		expect(run.errors.join("\n")).toContain("src/a.ts:\n    FOUR");
		expect(run.scripts).toEqual(["exec biome format --write .template.json"]);
		expect(run.errors.join("\n")).not.toContain("pnpm format");
	});

	it("follows the renames the release lists in the Project's own code", async () => {
		const release = (identifier: string, extra: TemplateFile[]) => [
			{ path: "CONTEXT.md", text: "# Template.\n" },
			{ path: "package.json", text: releaseManifest },
			{ path: "src/a.ts", text: `export const ${identifier} = 1;\n` },
			...extra,
		];
		const renames: Record<string, TemplateFile[]> = {
			"1.0.0": release("oldName", []),
			"1.1.0": release("newName", [
				{
					path: "template-renames.json",
					text: JSON.stringify([
						{ release: "1.1.0", identifiers: { oldName: "newName" } },
					]),
				},
			]),
		};
		using folder = projectCreate("export const oldName = 1;\n");
		const app = folder.path;
		writeFileSync(join(app, "src/own.ts"), "oldName();\n");
		gitRun(app, ["add", "."]);
		gitRun(app, ["commit", "--quiet", "-m", "own"]);
		const run = runCapture();

		expect(
			await templateUpgradeRun({
				appDirectory: app,
				to: "1.1.0",
				...run,
				tools: { fetch: (v) => renames[v] ?? [], finish: () => {} },
			}),
		).toBe(0);
		expect(readFileSync(join(app, "src/own.ts"), "utf8")).toBe("newName();\n");
		expect(existsSync(join(app, "template-renames.json"))).toBe(false);
		expect(run.logs.join("\n")).toContain("src/own.ts");
	});

	it("keeps the Project's contexts in CONTEXT-MAP.md when the Template changes its columns", async () => {
		const table = (columns: string, rows: string) =>
			`## Contexts\n\n${columns}\n| --- | --- |\n${rows}\n`;
		const maps: Record<string, TemplateFile[]> = {
			"1.0.0": [
				{
					path: "CONTEXT-MAP.md",
					text: table("| Context | Language |", "| `foo` | `f.md` |"),
				},
			],
			"1.1.0": [
				{
					path: "CONTEXT-MAP.md",
					text: table("| Context | Docs |", "| `foo` | `f.md` |"),
				},
			],
		};
		using folder = projectCreate("x\n");
		const app = folder.path;
		writeFileSync(
			join(app, "CONTEXT-MAP.md"),
			table("| Context | Language |", "| `league` | `l.md` |"),
		);
		gitRun(app, ["add", "."]);
		gitRun(app, ["commit", "--quiet", "-m", "map"]);

		expect(
			await templateUpgradeRun({
				appDirectory: app,
				to: "1.1.0",
				...runCapture(),
				tools: { fetch: (v) => maps[v] ?? [], finish: () => {} },
			}),
		).toBe(0);
		const text = readFileSync(join(app, "CONTEXT-MAP.md"), "utf8");
		expect(text).toContain("| Docs");
		expect(text).toContain("`league`");
		expect(text).not.toContain("`foo`");
	});

	it("asks for pnpm format when Biome cannot format .template.json on a conflict", async () => {
		using folder = projectCreate("one\ntwo\nthree\nFOUR\nfive\n");
		const app = folder.path;
		const run = runCapture();

		expect(
			await templateUpgradeRun({
				appDirectory: app,
				to: "1.1.0",
				tools,
				...run,
				pnpm: () => {
					throw new Error("biome.json holds conflict markers");
				},
			}),
		).toBe(1);
		expect(run.errors.join("\n")).toContain("conflicts in src/a.ts");
		expect(run.errors.join("\n")).toContain(
			"pnpm install, pnpm format, pnpm check and pnpm test",
		);
	});

	it("stops before the install when the Template dropped a dependency the Project still imports", async () => {
		const manifestOf = (icons: boolean) =>
			`${JSON.stringify({ dependencies: { ...(icons ? { "lucide-react": "^1.2.3" } : {}), "react-router": "1.0.0" }, name: "app" }, null, "\t")}\n`;
		const release = (icons: boolean, a: string): TemplateFile[] => [
			{ path: "package.json", text: manifestOf(icons) },
			{ path: "src/a.ts", text: a },
		];
		const drops: Record<string, TemplateFile[]> = {
			"3.0.0": release(true, "one\ntwo\nthree\nfour\nfive\n"),
			"3.1.0": release(false, "one\ntwo\nthree\n4\nfive\n"),
		};
		using folder = mkdtempDisposableSync(join(tmpdir(), "template-upgrade-"));
		const app = folder.path;
		gitRun(app, ["init", "--quiet", "--initial-branch=main"]);
		gitRun(app, ["config", "user.email", "test@example.com"]);
		gitRun(app, ["config", "user.name", "Test"]);
		execFileSync("mkdir", ["-p", join(app, "src")]);
		writeFileSync(
			join(app, ".template.json"),
			'{ "release": "3.0.0", "description": "Invoices." }\n',
		);
		writeFileSync(join(app, "package.json"), manifestOf(true));
		writeFileSync(
			join(app, "src/a.ts"),
			'import { Check } from "lucide-react";\none\ntwo\nthree\nfour\nfive\n',
		);
		gitRun(app, ["add", "."]);
		gitRun(app, ["commit", "--quiet", "-m", "project"]);
		const run = runCapture();

		expect(
			await templateUpgradeRun({
				appDirectory: app,
				to: "3.1.0",
				...run,
				tools: { fetch: (v) => drops[v] ?? [], finish: () => {} },
			}),
		).toBe(1);
		expect(run.errors.join("\n")).toContain("lucide-react (src/a.ts)");
		expect(run.errors.join("\n")).toContain("pnpm add lucide-react@^1.2.3");
		expect(run.scripts).toEqual([]);
	});

	it("renders a release with that release's own render code", async () => {
		using folder = projectCreate("one\ntwo\nthree\nfour\nfive\n");
		const app = folder.path;
		const own = {
			path: "scripts/template-render.ts",
			text: 'export const templateFilesRender = (files) => [...files.filter((f) => f.path !== "scripts/template-render.ts"), { path: "src/own.ts", text: "own\\n" }];\n',
		};
		const withOwn: UpgradeTools = {
			...tools,
			fetch: (version) =>
				version === "1.2.0"
					? [...(releases["1.0.0"] ?? []), own]
					: tools.fetch(version),
		};

		expect(
			await templateUpgradeRun({
				appDirectory: app,
				to: "1.2.0",
				tools: withOwn,
				...runCapture(),
			}),
		).toBe(0);
		expect(readFileSync(join(app, "src/own.ts"), "utf8")).toBe("own\n");
	});

	it("renders a release whose render code is split into modules", async () => {
		using folder = projectCreate("one\ntwo\nthree\nfour\nfive\n");
		const app = folder.path;
		const entry = {
			path: "scripts/template-render.ts",
			text: 'import { ownFile } from "./template-render-own.ts";\nexport const templateFilesRender = (files) => [...files.filter((f) => !f.path.startsWith("scripts/")), ownFile];\n',
		};
		const part = {
			path: "scripts/template-render-own.ts",
			text: 'export const ownFile = { path: "src/own.ts", text: "split\\n" };\n',
		};
		const withSplit: UpgradeTools = {
			...tools,
			fetch: (version) =>
				version === "1.2.0"
					? [...(releases["1.0.0"] ?? []), entry, part]
					: tools.fetch(version),
		};

		expect(
			await templateUpgradeRun({
				appDirectory: app,
				to: "1.2.0",
				tools: withSplit,
				...runCapture(),
			}),
		).toBe(0);
		expect(readFileSync(join(app, "src/own.ts"), "utf8")).toBe("split\n");
	});

	it("installs only after npm serves the tarballs the lockfile names, and says so when it never does", async () => {
		let asked = 0;
		const server = createServer((_request, response) => {
			asked += 1;
			response.writeHead(asked > 2 ? 200 : 404).end();
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		const registry = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
		try {
			using folder = projectCreate("one\ntwo\nthree\nfour\nfive\n");
			const app = folder.path;
			writeFileSync(
				join(app, "pnpm-lock.yaml"),
				"packages:\n\n  '@n8io/baseline-id@1.0.0':\n    resolution: {}\n",
			);
			gitRun(app, ["commit", "--quiet", "-am", "lockfile"]);
			const run = runCapture();
			expect(
				await templateUpgradeRun({
					appDirectory: app,
					to: "1.1.0",
					tools,
					...run,
					tarballsWait: () =>
						npmTarballsWait({
							directory: app,
							intervalMs: 5,
							log: () => {},
							registry,
						}),
				}),
			).toBe(0);
			expect(asked).toBe(3);
			expect(run.scripts[0]).toBe("install --lockfile-only");
			expect(run.scripts[1]).toBe("install");
		} finally {
			server.close();
		}
	});

	it("stops before installing when the wait runs out, and names the reason", async () => {
		using folder = projectCreate("one\ntwo\nthree\nfour\nfive\n");
		const run = runCapture();

		expect(
			await templateUpgradeRun({
				appDirectory: folder.path,
				to: "1.1.0",
				tools,
				...run,
				tarballsWait: async () => {
					throw new Error("npm still answers 404 for baseline-id");
				},
			}),
		).toBe(1);
		expect(run.errors.join("\n")).toContain(
			"the install could not start: npm still answers 404 for baseline-id",
		);
		expect(run.errors.join("\n")).toContain("Run pnpm install, pnpm format");
		expect(run.scripts).toEqual(["install --lockfile-only"]);
	});

	it("refuses a dirty working tree", async () => {
		using folder = projectCreate("one\ntwo\nthree\nfour\nfive\n");
		const app = folder.path;
		writeFileSync(join(app, "src/a.ts"), "dirty\n");
		const run = runCapture();

		expect(
			await templateUpgradeRun({
				appDirectory: app,
				to: "1.1.0",
				tools,
				...run,
			}),
		).toBe(1);
		expect(run.errors.join("\n")).toContain("working tree has changes");
	});
});

describe("changelogBetween", () => {
	it("keeps the releases after the old one up to the new one", () => {
		const changelog =
			"# app\n\n## 1.10.0\n\n- C\n\n## 1.2.0\n\n- B\n\n## 1.1.0\n\n- A\n";

		expect(changelogBetween({ changelog, from: "1.1.0", to: "1.10.0" })).toBe(
			"## 1.10.0\n\n- C\n\n## 1.2.0\n\n- B",
		);
	});
});

describe("workspaceExcludesDedupe", () => {
	const template = 'minimumReleaseAgeExclude:\n  - "@n8io/baseline-*"\n';
	const pnpmList =
		'minimumReleaseAgeExclude:\n  - "@n8io/baseline-authn@2.0.0"\n  - "@n8io/baseline-cache@2.0.0"\n';

	it("drops the exact-version list pnpm wrote when the template brings its own", () => {
		expect(
			workspaceExcludesDedupe(
				`${template}allowBuilds:\n  a: true\n${pnpmList}x: 1\n`,
			),
		).toBe(`${template}allowBuilds:\n  a: true\nx: 1\n`);
	});

	it("keeps a single list, even one of exact versions", () => {
		expect(workspaceExcludesDedupe(pnpmList)).toBe(pnpmList);
	});

	it("keeps a second list that names anything but baseline versions", () => {
		const other = 'minimumReleaseAgeExclude:\n  - "react@19.0.0"\n';
		expect(workspaceExcludesDedupe(`${template}${other}`)).toBe(
			`${template}${other}`,
		);
	});
});

describe("languageKeep", () => {
	const language = "## Language\n\n**Invoice**:\nA bill.\n";

	it("carries the Project's terms into every render's CONTEXT.md", () => {
		const files = [
			{
				path: "CONTEXT.md",
				text: "# T.\n\n## Architecture\n\nold\n\n## Language\n",
			},
			{ path: "src/a.ts", text: "a\n" },
		];

		expect(languageKeep({ files, project: `# Mine.\n\n${language}` })).toEqual([
			{
				path: "CONTEXT.md",
				text: `# T.\n\n## Architecture\n\nold\n\n${language}`,
			},
			{ path: "src/a.ts", text: "a\n" },
		]);
		expect(
			languageKeep({
				files: [
					{ path: "CONTEXT.md", text: "# T.\n\n## Architecture\n\nnew\n" },
				],
				project: `# Mine.\n\n${language}`,
			}),
		).toEqual([
			{
				path: "CONTEXT.md",
				text: `# T.\n\n## Architecture\n\nnew\n\n${language}`,
			},
		]);
	});

	it("leaves the renders alone when the Project has no terms there", () => {
		const files = [{ path: "CONTEXT.md", text: "# T.\n\n## Language\n" }];

		expect(languageKeep({ files, project: "# Mine.\n\n## Language\n" })).toBe(
			files,
		);
		expect(languageKeep({ files, project: "# Mine.\n" })).toBe(files);
	});

	it("lets an upgrade drop the Template's ## Language without a conflict", async () => {
		const release = (
			architecture: string,
			heading: boolean,
		): TemplateFile[] => [
			{
				path: "CONTEXT.md",
				text: `# Template.\n\n## Architecture\n\n${architecture}\n${heading ? "\n## Language\n" : ""}`,
			},
			{ path: "package.json", text: releaseManifest },
		];
		const contexts: Record<string, TemplateFile[]> = {
			"3.0.0": release("old", true),
			"4.0.0": release("new", false),
		};
		using folder = mkdtempDisposableSync(join(tmpdir(), "template-upgrade-"));
		const app = folder.path;
		gitRun(app, ["init", "--quiet", "--initial-branch=main"]);
		gitRun(app, ["config", "user.email", "test@example.com"]);
		gitRun(app, ["config", "user.name", "Test"]);
		writeFileSync(
			join(app, ".template.json"),
			'{ "release": "3.0.0", "description": "Invoices." }\n',
		);
		writeFileSync(join(app, "package.json"), manifest);
		writeFileSync(
			join(app, "CONTEXT.md"),
			`# Invoices.\n\n## Architecture\n\nold\n\n${language}`,
		);
		gitRun(app, ["add", "."]);
		gitRun(app, ["commit", "--quiet", "-m", "project"]);

		expect(
			await templateUpgradeRun({
				appDirectory: app,
				to: "4.0.0",
				...runCapture(),
				tools: { fetch: (v) => contexts[v] ?? [], finish: () => {} },
			}),
		).toBe(0);
		expect(readFileSync(join(app, "CONTEXT.md"), "utf8")).toBe(
			`# Invoices.\n\n## Architecture\n\nnew\n\n${language}`,
		);
	});
});

describe("secretKeep", () => {
	it("puts the Project's AUTHN_SECRET into a rendered .env.development only", () => {
		const files = [
			{ path: ".env.development", text: "A=1\nAUTHN_SECRET=template\nB=2\n" },
			{ path: ".env.test", text: "AUTHN_SECRET=template\n" },
		];

		expect(secretKeep({ files, project: "A=1\nAUTHN_SECRET=mine\n" })).toEqual([
			{ path: ".env.development", text: "A=1\nAUTHN_SECRET=mine\nB=2\n" },
			{ path: ".env.test", text: "AUTHN_SECRET=template\n" },
		]);
		expect(secretKeep({ files, project: "A=1\n" })).toEqual(files);
	});
});
