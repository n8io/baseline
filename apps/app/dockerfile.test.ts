import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
	readFileSync(new URL(`./${path}`, import.meta.url), "utf8");

type Instruction = { args: string; keyword: string };

// One entry per instruction: comments dropped, backslash continuations joined.
const instructionsParse = (text: string): Instruction[] =>
	text
		.split("\n")
		.filter((line) => !line.trimStart().startsWith("#"))
		.join("\n")
		.replaceAll(/\\\n/g, " ")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "")
		.map((line) => {
			const [keyword = "", ...rest] = line.split(/\s+/);
			return { args: rest.join(" "), keyword: keyword.toUpperCase() };
		});

const dockerfile = read("Dockerfile");
const instructions = instructionsParse(dockerfile);
const stages = instructions.reduce<Instruction[][]>((all, instruction) => {
	if (instruction.keyword === "FROM") {
		all.push([]);
	}
	all.at(-1)?.push(instruction);
	return all;
}, []);
const runtime = stages.at(-1) ?? [];
const packageManagers = /\b(pnpm|npm|npx|yarn|corepack)\b/;
const preloadEnv = 'NODE_OPTIONS="--import /app/src/preload.ts"';
// The tracing preloads, which only src/preload.ts may name. Tests and vitest load
// varlock/auto-load alone, so it is checked in src/preload.ts but allowed elsewhere.
const tracingModules = [
	"@n8io/baseline-telemetry/register",
	"import-in-the-middle/register-hooks.mjs",
];

// Every entry the image runs: the CMD, and each command compose passes.
const entries = (): string[][] => {
	const commands = instructions
		.filter(({ keyword }) => keyword === "CMD" || keyword === "ENTRYPOINT")
		.map(({ args }) => JSON.parse(args) as string[]);
	const compose = read("compose.yaml");
	const composeCommands = [...compose.matchAll(/command:\s*(\[[^\]]*\])/g)].map(
		([, list = "[]"]) =>
			JSON.parse(list.replaceAll(/,\s*\]/g, "]")) as string[],
	);
	return [...commands, ...composeCommands];
};

describe("Dockerfile", () => {
	it("builds from node:26-slim pinned by digest in every stage", () => {
		const froms = instructions.filter(({ keyword }) => keyword === "FROM");
		expect(froms).toHaveLength(2);
		for (const { args } of froms) {
			expect(args).toMatch(/^node:26-slim@sha256:[0-9a-f]{64}( AS \w+)?$/);
		}
	});

	it("installs the pnpm version package.json pins", () => {
		const { packageManager } = JSON.parse(read("package.json")) as {
			packageManager: string;
		};
		expect(dockerfile).toContain(`npm install --global ${packageManager}`);
	});

	it("builds with no registry token or secret", () => {
		expect(dockerfile).not.toMatch(/--mount=type=secret|_authToken/);
		const declared = instructions.filter(
			({ keyword }) => keyword === "ARG" || keyword === "ENV",
		);
		for (const { args } of declared) {
			expect(args).not.toMatch(/token|secret|password|_auth/i);
		}
	});

	it("preloads src/preload.ts for every entry through one NODE_OPTIONS line", () => {
		const options = instructions.filter(
			({ args, keyword }) => keyword === "ENV" && args.includes("NODE_OPTIONS"),
		);
		expect(options).toEqual([{ args: preloadEnv, keyword: "ENV" }]);
		expect(runtime).toContainEqual({ args: preloadEnv, keyword: "ENV" });
	});

	it("runs every entry in exec form as node <entry>, with no preload flags", () => {
		const commands = instructions.filter(
			({ keyword }) => keyword === "CMD" || keyword === "ENTRYPOINT",
		);
		expect(commands.map(({ keyword }) => keyword)).toEqual(["CMD"]);
		expect(commands[0]?.args.startsWith("[")).toBe(true);
		const all = entries();
		expect(all.map((entry) => entry.at(-1))).toEqual([
			"build/server/index.js",
			// piece-start: queue
			"src/worker.ts",
			// piece-end: queue
		]);
		for (const entry of all) {
			expect(entry).toHaveLength(2);
			expect(entry[0]).toBe("node");
			expect(entry.join(" ")).not.toMatch(packageManagers);
		}
	});

	it("names its other entries in its comments", () => {
		// piece-start: queue
		expect(dockerfile).toContain('worker:  ["node", "src/worker.ts"]');
		// piece-end: queue
		expect(dockerfile).toContain('migrate: ["node", "src/migrate.ts"]');
		expect(dockerfile).toMatch(/30 s grace period/);
	});

	it("runs as node with production settings", () => {
		expect(runtime.filter(({ keyword }) => keyword === "USER")).toEqual([
			{ args: "node", keyword: "USER" },
		]);
		expect(runtime).toContainEqual({
			args: "NODE_ENV=production APP_ENV=production",
			keyword: "ENV",
		});
		expect(
			runtime.some(
				({ args, keyword }) => keyword === "RUN" || packageManagers.test(args),
			),
		).toBe(false);
	});

	it("copies migrations, .env.schema and .env.production and no other env file", () => {
		const copies = runtime
			.filter(({ keyword }) => keyword === "COPY")
			.map(({ args }) => args);
		expect(copies).toContain("--from=build /app/migrations ./migrations");
		const envFiles = copies.flatMap(
			(args) => args.match(/\S*\.env[^\s/]*/g) ?? [],
		);
		expect(envFiles.map((path) => path.replace(/^\/app\//, ""))).toEqual([
			".env.schema",
			".env.production",
		]);
		// The runtime stage copies only named build outputs, never the build context.
		expect(copies.every((args) => args.startsWith("--from=build /"))).toBe(
			true,
		);
	});
});

describe("src/preload.ts", () => {
	it("is the only file that names the tracing preloads", () => {
		const skipped = /(^|\/)(node_modules|build|\.git|\.react-router)(\/|$)/;
		const root = fileURLToPath(new URL("./", import.meta.url));
		const offenders = readdirSync(root, {
			recursive: true,
			withFileTypes: true,
		})
			.filter((entry) => entry.isFile())
			.map((entry) => relative(root, join(entry.parentPath, entry.name)))
			.filter(
				(path) =>
					!skipped.test(path) &&
					!["CHANGELOG.md", "dockerfile.test.ts", "src/preload.ts"].includes(
						path,
					),
			)
			.filter((path) => {
				const text = readFileSync(
					new URL(`./${path}`, import.meta.url),
					"utf8",
				);
				return tracingModules.some((name) => text.includes(name));
			});
		expect(offenders).toEqual([]);
		const preload = read("src/preload.ts");
		for (const name of ["varlock/auto-load", ...tracingModules]) {
			expect(preload).toContain(`"${name}"`);
		}
	});
});

describe("image-budget.json", () => {
	it("holds a whole number of megabytes", () => {
		const budget = JSON.parse(read("image-budget.json")) as unknown;
		expect(budget).toEqual({ megabytes: expect.any(Number) });
		expect(Number.isInteger((budget as { megabytes: number }).megabytes)).toBe(
			true,
		);
	});
});

describe(".npmrc", () => {
	// pnpm reads only auth and registry lines from .npmrc and ignores the rest, so settings
	// belong in pnpm-workspace.yaml. Checks the workspace root's file too (../../ in baseline).
	it("holds only auth and registry lines", () => {
		const root = existsSync(new URL("./pnpm-workspace.yaml", import.meta.url))
			? "./"
			: "../../";
		const settings = [...new Set(["./.npmrc", `${root}.npmrc`])]
			.map((path) => new URL(path, import.meta.url))
			.filter((url) => existsSync(url))
			.flatMap((url) => readFileSync(url, "utf8").split("\n"))
			.map((line) => line.trim())
			.filter((line) => line !== "" && !/^[#;]/.test(line))
			.filter(
				(line) =>
					!/^(@[\w.-]+:)?registry=|^\/\/[^=]+:(_authToken|_auth|_password|username|email|certfile|keyfile)=/.test(
						line,
					),
			);
		expect(settings).toEqual([]);
	});
});
