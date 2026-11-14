import { execFileSync } from "node:child_process";
import {
	type DisposableTempDir,
	mkdtempDisposableSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TemplateFile } from "./template-render.ts";
import {
	changelogBetween,
	secretKeep,
	templateUpgradeRun,
	type UpgradeTools,
	workspaceExcludesDedupe,
} from "./template-upgrade.ts";

afterEach(() => {
	vi.restoreAllMocks();
});

const git = (cwd: string, ...args: string[]) =>
	execFileSync("git", args, { cwd, encoding: "utf8" });

const manifest = '{\n\t"name": "invoicing"\n}\n';
const lockfile = "biome: 2.6.5\nzod: 4.6.7\n";
const releases: Record<string, TemplateFile[]> = {
	"1.0.0": [
		{ path: "CONTEXT.md", text: "# Template.\n" },
		{ path: "package.json", text: '{ "name": "app" }' },
		{ path: "pnpm-lock.yaml", text: "biome: 2.6.5\n" },
		{ path: "src/a.ts", text: "one\ntwo\nthree\nfour\nfive\n" },
	],
	"1.1.0": [
		{
			path: "CHANGELOG.md",
			text: "# app\n\n## 1.1.0\n\n- Four is 4.\n\n## 1.0.0\n\n- First.\n",
		},
		{ path: "CONTEXT.md", text: "# Template.\n" },
		{ path: "package.json", text: '{ "name": "app" }' },
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
		const pnpm = vi.fn();
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		expect(
			await templateUpgradeRun({ appDirectory: app, to: "1.1.0", tools, pnpm }),
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
		expect(pnpm.mock.calls.map(([s]) => s)).toEqual([
			"install",
			"format",
			"check",
			"test",
		]);
		expect(log.mock.calls.flat().join("\n")).toContain("- Four is 4.");
	});

	it("exits before the checks when the project is already on the target release", async () => {
		using folder = projectCreate("one\ntwo\nthree\nfour\nfive\n");
		const app = folder.path;
		const pnpm = vi.fn();
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		expect(
			await templateUpgradeRun({ appDirectory: app, to: "1.0.0", tools, pnpm }),
		).toBe(0);
		expect(log.mock.calls.flat().join("\n")).toContain(
			"already on release 1.0.0; nothing to upgrade",
		);
		expect(pnpm).not.toHaveBeenCalled();
		expect(git(app, "status", "--porcelain")).toBe("");
	});

	it("leaves conflict markers and exits 1 when both sides changed the same line", async () => {
		using folder = projectCreate("one\ntwo\nthree\nFOUR\nfive\n");
		const app = folder.path;
		const pnpm = vi.fn();
		vi.spyOn(console, "log").mockImplementation(() => {});
		const error = vi.spyOn(console, "error").mockImplementation(() => {});

		expect(
			await templateUpgradeRun({ appDirectory: app, to: "1.1.0", tools, pnpm }),
		).toBe(1);
		expect(readFileSync(join(app, "src/a.ts"), "utf8")).toMatch(
			/<<<<<<< [^\n]*\nFOUR\n=======\n4\n>>>>>>> /,
		);
		expect(error.mock.calls.flat().join("\n")).toContain(
			"conflicts in src/a.ts",
		);
		expect(pnpm).not.toHaveBeenCalled();
	});

	it("renders a release with that release's own render code", async () => {
		using folder = projectCreate("one\ntwo\nthree\nfour\nfive\n");
		const app = folder.path;
		vi.spyOn(console, "log").mockImplementation(() => {});
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
				pnpm: vi.fn(),
			}),
		).toBe(0);
		expect(readFileSync(join(app, "src/own.ts"), "utf8")).toBe("own\n");
	});

	it("refuses a dirty working tree", async () => {
		using folder = projectCreate("one\ntwo\nthree\nfour\nfive\n");
		const app = folder.path;
		writeFileSync(join(app, "src/a.ts"), "dirty\n");
		const error = vi.spyOn(console, "error").mockImplementation(() => {});

		expect(
			await templateUpgradeRun({
				appDirectory: app,
				to: "1.1.0",
				tools,
				pnpm: vi.fn(),
			}),
		).toBe(1);
		expect(error.mock.calls.flat().join("\n")).toContain(
			"working tree has changes",
		);
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
