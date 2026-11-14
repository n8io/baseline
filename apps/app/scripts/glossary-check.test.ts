import { describe, expect, it } from "vitest";
import {
	glossaryAliasesRead,
	glossaryDiffAddedLines,
	glossaryHitFormat,
	glossaryHitsFind,
} from "./glossary-check.ts";

const context = [
	"# A project.",
	"",
	"## Architecture",
	"",
	"**Live update**:",
	"A short note.",
	"_Avoid_: push, real-time event",
	"",
	"## Language",
	"",
	"**Invoice line**:",
	"One line of an invoice.",
	"_Avoid_: item",
].join("\n");

const diff = [
	"diff --git a/src/a.ts b/src/a.ts",
	"--- a/src/a.ts",
	"+++ b/src/a.ts",
	"@@ -3,0 +4,2 @@",
	"+// Sends a Push to every item.",
	"+const pushed = items;",
	"@@ -10 +12 @@",
	"-old",
	"+// a real-time event",
	"diff --git a/CONTEXT.md b/CONTEXT.md",
	"+++ b/CONTEXT.md",
	"@@ -1 +1 @@",
	"+_Avoid_: push",
].join("\n");

describe("glossary-check", () => {
	it("reads every alias with its term from both sections", () => {
		expect(glossaryAliasesRead(context)).toEqual([
			{ alias: "push", term: "Live update" },
			{ alias: "real-time event", term: "Live update" },
			{ alias: "item", term: "Invoice line" },
		]);
	});

	it("numbers added lines as they are in the new file", () => {
		expect(glossaryDiffAddedLines(diff).slice(0, 3)).toEqual([
			{ file: "src/a.ts", line: 4, text: "// Sends a Push to every item." },
			{ file: "src/a.ts", line: 5, text: "const pushed = items;" },
			{ file: "src/a.ts", line: 12, text: "// a real-time event" },
		]);
	});

	it("finds whole-word hits in any case and skips CONTEXT.md", () => {
		const hits = glossaryHitsFind({
			aliases: glossaryAliasesRead(context),
			diff,
			textRead: () =>
				"\n\n\n// Sends a Push to every item.\nconst pushed = items;\n\n\n\n\n\n\n// a real-time event",
		});

		expect(hits.map((h) => `${h.line} ${h.alias}`)).toEqual([
			"4 push",
			"4 item",
			"12 real-time event",
		]);
	});

	it("skips an alias inside a path or script name but not at a sentence end", () => {
		const aliases = [{ alias: "integration", term: "Bridge" }];
		const pathDiff = [
			"+++ b/src/a.ts",
			"@@ -0,0 +1,3 @@",
			"+import { db } from '../test/integration/db.ts';",
			"+// see integration.test.ts, then run pnpm test:integration",
			"+// Calls the integration.",
		].join("\n");
		const pathText = [
			"import { db } from '../test/integration/db.ts';",
			"// see integration.test.ts, then run pnpm test:integration",
			"// Calls the integration.",
		].join("\n");

		expect(
			glossaryHitsFind({
				aliases,
				diff: pathDiff,
				textRead: () => pathText,
			}).map((h) => h.line),
		).toEqual([3]);
	});

	it("prints a GitHub annotation in Actions and a plain line elsewhere", () => {
		const hit = {
			alias: "push",
			file: "src/a.ts",
			line: 4,
			term: "Live update",
		};

		expect(glossaryHitFormat(hit, true)).toBe(
			'::warning file=src/a.ts,line=4::"push" is an alias of "Live update"',
		);
		expect(glossaryHitFormat(hit, false)).toBe(
			'src/a.ts:4: "push" is an alias of "Live update"',
		);
	});

	describe("prose only", () => {
		const aliases = [
			{ alias: "client", term: "Machine client" },
			{ alias: "schema", term: "Table" },
			{ alias: "main", term: "Entry" },
		];
		const hitsIn = (file: string, text: string): number[] =>
			glossaryHitsFind({
				aliases,
				diff: [
					`+++ b/${file}`,
					`@@ -0,0 +1,${text.split("\n").length} @@`,
					...text.split("\n").map((row) => `+${row}`),
				].join("\n"),
				textRead: () => text,
			}).map((hit) => hit.line);

		it("skips migrations and JSON files", () => {
			expect(hitsIn("src/migrations/0001.sql", "-- the client schema")).toEqual(
				[],
			);
			expect(
				hitsIn("drizzle/meta/0001_snapshot.json", '"schema": "client"'),
			).toEqual([]);
		});

		it("skips identifiers, keys, JSX element names and a kind value", () => {
			const text = [
				"const row = { schema: table, client: null };",
				"const page = <main>{value}</main>;",
				'const token = { kind: "client" };',
			].join("\n");

			expect(hitsIn("src/a.tsx", text)).toEqual([]);
		});

		it("reads multi-line comments and template literals line by line", () => {
			const text = [
				"/*",
				" the client",
				" */",
				"const a = `",
				"the schema`;",
			].join("\n");

			expect(hitsIn("src/a.ts", text)).toEqual([2, 5]);
		});

		it("still finds an alias in a comment or a string", () => {
			const text = [
				"// the client",
				'const label = "the schema";',
				"const note = `an main`;",
			].join("\n");

			expect(hitsIn("src/a.ts", text)).toEqual([1, 2, 3]);
		});

		it("tests every line of a text file", () => {
			expect(hitsIn("docs/a.md", "the client\nnothing")).toEqual([1]);
		});
	});
});
