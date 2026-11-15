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
import type { TemplateFile } from "./template-render.ts";
import {
	changelogBetween,
	secretKeep,
	templateUpgradeRun,
	type UpgradeTools,
	workspaceExcludesDedupe,
} from "./template-upgrade.ts";

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

const git = (cwd: string, ...args: string[]) =>
	execFileSync("git", args, { cwd, encoding: "utf8" });

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
	git(app, "init", "--quiet", "--initial-branch=main");
	git(app, "config", "user.email", "test@example.com");
	git(app, "config", "user.name", "Test");
	const files: Record<string, string> = {
		".template.json": '{ "release": "1.0.0", "description": "Invoices." }\n',
		"CONTEXT.md": "# Invoices.\n",
		"package.json": manifest,
		"pnpm-lock.yaml": lockfile,
		"src/a.ts": a,
		"src/domains/.gitkeep": "",
	};
	for (const [path, text] of Object.entries(files)) {
		execFileSync("mkdir", ["-p", join(app, path, "..")]);
		writeFileSync(join(app, path), text);
	}
	git(app, "add", ".");
	git(app, "commit", "--quiet", "-m", "project");
	return folder;
};

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
		expect(git(app, "rev-list", "--count", "HEAD").trim()).toBe("1");
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
		git(app, "init", "--quiet", "--initial-branch=main");
		git(app, "config", "user.email", "test@example.com");
		git(app, "config", "user.name", "Test");
		execFileSync("mkdir", ["-p", join(app, "src")]);
		writeFileSync(
			join(app, ".template.json"),
			'{ "release": "2.0.0", "description": "Invoices." }\n',
		);
		writeFileSync(join(app, "package.json"), manifestOf(false));
		writeFileSync(join(app, "src/a.ts"), 'import a from "a";\nold\n');
		git(app, "add", ".");
		git(app, "commit", "--quiet", "-m", "project");

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
		expect(git(app, "status", "--porcelain")).toBe("");
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
			git(app, "commit", "--quiet", "-am", "lockfile");
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
