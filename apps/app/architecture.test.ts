import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	type ArchitectureFile,
	architectureFileCreate,
	architectureRules,
	architectureSrcRead,
} from "./architecture-test-rules.ts";

// The files this test reads or runs from disk, so `pnpm test --changed` runs it when one changes.
import.meta.glob(["./src/**", "./architecture-test-samples/*.txt"], {
	query: "?raw",
});

const appRoot = fileURLToPath(new URL("./", import.meta.url));
const samplesDir = new URL("./architecture-test-samples/", import.meta.url);
const ruleIds = Object.keys(architectureRules);

const files = await architectureSrcRead(appRoot);

// A sample: `// A1: <rule>`, `// expect: <part of the message>`, then `// @file <path>` sections.
const samplesRead = () =>
	Promise.all(
		readdirSync(samplesDir)
			.filter((name) => name.endsWith(".txt"))
			.sort()
			.map(async (name) => {
				const text = readFileSync(new URL(name, samplesDir), "utf8");
				const rule = /^\/\/ (A\d+):/m.exec(text)?.[1] ?? "";
				const expected = /^\/\/ expect: (.+)$/m.exec(text)?.[1] ?? "";
				const sections = text.split(/^\/\/ @file (\S+)\n/m).slice(1);
				const sampleFiles: Promise<ArchitectureFile>[] = [];
				for (let i = 0; i < sections.length; i += 2) {
					sampleFiles.push(
						architectureFileCreate(sections[i] ?? "", sections[i + 1] ?? ""),
					);
				}
				return { expected, files: await Promise.all(sampleFiles), name, rule };
			}),
	);
const samples = await samplesRead();

describe("architecture", () => {
	it("reads every source file and its imports", () => {
		// Domain-generic, so it holds after template-render removes the example domain.
		const server = files.find((f) => f.path === "src/server.ts");
		expect(files.length).toBeGreaterThan(10);
		expect(server?.imports.map((imp) => imp.target)).toContain("src/env.ts");
		// piece-start: ui
		const root = files.find((f) => f.path === "src/ui/root.tsx");
		expect(root?.imports.map((imp) => imp.specifier)).toContain("react-router");
		// piece-end: ui
	});

	it.each(ruleIds)("src/ keeps rule %s", (rule) => {
		expect(architectureRules[rule]?.(files)).toEqual([]);
	});

	it("has a failing sample for every rule", () => {
		expect([...new Set(samples.map((s) => s.rule))].sort()).toEqual(
			[...ruleIds].sort(),
		);
	});

	// The regex checks of A11 and A14 also pass the corrected sample.
	it.each([
		{
			from: "\tensure: (name) => u.bazCreate(actor, { name }),\n",
			name: "a11-bridge-writes.txt",
			to: "",
		},
		{
			from: '"baz.created"',
			name: "a14-column-without-consumer.txt",
			to: '"baz.deleted"',
		},
	])("$name passes once fixed", async ({ from, name, to }) => {
		const sample = samples.find((s) => s.name === name);
		const fixed = await Promise.all(
			(sample?.files ?? []).map((f) =>
				architectureFileCreate(f.path, f.source.replace(from, to)),
			),
		);
		expect(fixed.map((f) => f.source).join("")).not.toContain(from);
		expect(architectureRules[sample?.rule ?? ""]?.(fixed)).toEqual([]);
	});

	// The passing side of each rule that A2, A14 and A25 loosened or added.
	it("A2 lets a rule import a sibling rule and the id and result types", async () => {
		const rule = await architectureFileCreate(
			"src/domains/bar/rules/bar-open.ts",
			'import type { Id } from "@n8io/baseline-id";\nimport type { Result } from "@n8io/baseline-result";\nimport { barClosedIs } from "./bar-closed.ts";\n',
		);
		expect(architectureRules.A2?.([rule])).toEqual([]);
		const value = await architectureFileCreate(
			"src/domains/bar/rules/bar-open.ts",
			'import { ok } from "@n8io/baseline-result";\n',
		);
		expect(architectureRules.A2?.([value])).toHaveLength(1);
	});

	it("A14 passes once the other domain's deleted Event has a Consumer", async () => {
		const sample = samples.find(
			(s) => s.name === "a14-prefix-column-without-consumer.txt",
		);
		expect(sample).toBeDefined();
		const consumer = await architectureFileCreate(
			"src/domains/trade/api/trade-team-deleted-consumer.ts",
			'export const x = "team.deleted";\n',
		);
		expect(
			architectureRules.A14?.([...(sample?.files ?? []), consumer]),
		).toEqual([]);
	});

	it("A14 counts only the longest domain name a column matches", async () => {
		const table = await architectureFileCreate(
			"src/domains/trade/spi/trade-table.ts",
			'import { uuid } from "drizzle-orm/pg-core";\nexport const t = { workOrderId: uuid("work_order_id") };\n',
		);
		const files = [
			table,
			await architectureFileCreate(
				"src/domains/order/index.ts",
				"export {};\n",
			),
			await architectureFileCreate(
				"src/domains/work-order/index.ts",
				"export {};\n",
			),
		];
		expect(architectureRules.A14?.(files)).toHaveLength(1);
		expect(architectureRules.A14?.(files)[0]).toContain("a work-order id");
	});

	it("A25 lets api/ build its own schema from a model's shape", async () => {
		const route = await architectureFileCreate(
			"src/domains/bar/api/bar-routes.ts",
			'import { z } from "@hono/zod-openapi";\nimport { Bar } from "../models/bar.ts";\n\nexport const BarResponse = z\n\t.object({ name: Bar.shape.name })\n\t.openapi("BarResponse");\n',
		);
		expect(architectureRules.A25?.([route])).toEqual([]);
	});

	it("A26 lets a Use case build a Date from a value", async () => {
		const useCase = await architectureFileCreate(
			"src/domains/bar/use-cases/bar-close.ts",
			"export const barClose = (ports: { barClock: { now(): Date } }) => ({\n\tclosedAt: ports.barClock.now(),\n\tdueAt: new Date(ports.barClock.now().getTime() + 1),\n});\n",
		);
		expect(architectureRules.A26?.([useCase])).toEqual([]);
	});

	it("A27 skips comments, tests and adapters", async () => {
		const files = await Promise.all([
			architectureFileCreate(
				"src/domains/bar/use-cases/bar-get.ts",
				"// The repository throws only for the unexpected.\n/* never throw here */\nexport const barGet = () => 1;\n",
			),
			architectureFileCreate(
				"src/domains/bar/use-cases/bar-get.test.ts",
				'it("x", () => { throw new Error("x"); });\n',
			),
			architectureFileCreate(
				"src/domains/bar/spi/bar-repository-postgres.ts",
				"export const x = () => { try { return 1; } catch { throw new Error(); } };\n",
			),
		]);
		expect(architectureRules.A27?.(files)).toEqual([]);
	});

	const a27Why =
		"// unreachable: only the closed flag changes, so no key breaks.";
	it.each([
		{ body: `${a27Why}\nthrow new Error("unreachable");`, found: 0 },
		{ body: 'const s = "cannot throw; we catch nothing";', found: 0 },
		{ body: "const k = { catch: 1, throw: 2 };\ngen.throw(1);", found: 0 },
		{ body: "// unreachable: a bug\nthrow new Error();", found: 1 },
		{ body: `${a27Why}\nthrow new BarNotFoundError();`, found: 1 },
		{ body: `${a27Why}\n\nthrow new Error();`, found: 1 },
		{
			body: `const s = "${a27Why.slice(1, -1)}";\nthrow new Error();`,
			found: 1,
		},
		{ body: 'const u = "http://x"; throw new Error(u);', found: 1 },
		{ body: 'const g = "/*";\nthrow new Error();\nconst h = "*/";', found: 1 },
		{ body: `${a27Why}\ntry {\n\tx();\n} finally {\n\ty();\n}`, found: 1 },
		{ body: "p.catch(() => 1);", found: 1 },
		{ body: "return Promise .reject(e);", found: 1 },
	])("A27 finds $found in: $body", async ({ body, found }) => {
		const file = await architectureFileCreate(
			"src/domains/bar/use-cases/bar-close.ts",
			body,
		);
		expect(architectureRules.A27?.([file])).toHaveLength(found);
	});

	it("A27 tells a Rule to return a plain value", async () => {
		const rule = await architectureFileCreate(
			"src/domains/bar/rules/bar-open-can.ts",
			'export const barOpenCan = () => {\n\tthrow new Error("closed");\n};\n',
		);
		expect(architectureRules.A27?.([rule])).toEqual([
			expect.stringContaining(
				"bar-open-can.ts:2: throw in a Rule; a Rule returns a plain value",
			),
		]);
	});

	it.each(samples)("$name fails $rule", ({ expected, files, rule }) => {
		expect(expected).not.toBe("");
		expect(architectureRules[rule]?.(files)).toContainEqual(
			expect.stringContaining(expected),
		);
	});
});
