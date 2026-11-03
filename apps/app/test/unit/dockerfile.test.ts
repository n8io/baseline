import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
	readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

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
const preloads = [
	"--import",
	"varlock/auto-load",
	"--import",
	"@n8io/baseline-telemetry/register",
	"--experimental-loader=@opentelemetry/instrumentation/hook.mjs",
];

// Every entry the image runs: the CMD, and the worker command compose passes.
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

	it("reads the packages token only from a BuildKit secret", () => {
		expect(dockerfile).toContain("--mount=type=secret,id=packages_token");
		const declared = instructions.filter(
			({ keyword }) => keyword === "ARG" || keyword === "ENV",
		);
		for (const { args } of declared) {
			expect(args).not.toMatch(/token|secret|password|_auth/i);
		}
	});

	it("runs every entry in exec form with the three preloads, varlock first", () => {
		const commands = instructions.filter(
			({ keyword }) => keyword === "CMD" || keyword === "ENTRYPOINT",
		);
		expect(commands.map(({ keyword }) => keyword)).toEqual(["CMD"]);
		expect(commands[0]?.args.startsWith("[")).toBe(true);
		const all = entries();
		expect(all.map((entry) => entry.at(-1))).toEqual([
			"build/server/index.js",
			"src/worker.ts",
		]);
		for (const entry of all) {
			expect(entry.slice(0, 6)).toEqual(["node", ...preloads]);
			expect(entry).toHaveLength(7);
			expect(entry.join(" ")).not.toMatch(packageManagers);
		}
	});

	it("names the worker and migrate entries in its comments", () => {
		expect(dockerfile).toContain(
			'worker:  [... same flags ..., "src/worker.ts"]',
		);
		expect(dockerfile).toContain(
			'migrate: [... same flags ..., "src/migrate.ts"]',
		);
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

describe("image-budget.json", () => {
	it("holds a whole number of megabytes", () => {
		const budget = JSON.parse(read("image-budget.json")) as unknown;
		expect(budget).toEqual({ megabytes: expect.any(Number) });
		expect(Number.isInteger((budget as { megabytes: number }).megabytes)).toBe(
			true,
		);
	});
});
