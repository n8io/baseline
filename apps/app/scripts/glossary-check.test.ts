import { describe, expect, it } from "vitest";
import {
	diffAddedLines,
	glossaryAliasesRead,
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
		expect(diffAddedLines(diff).slice(0, 3)).toEqual([
			{ file: "src/a.ts", line: 4, text: "// Sends a Push to every item." },
			{ file: "src/a.ts", line: 5, text: "const pushed = items;" },
			{ file: "src/a.ts", line: 12, text: "// a real-time event" },
		]);
	});

	it("finds whole-word hits in any case and skips CONTEXT.md", () => {
		const hits = glossaryHitsFind(diff, glossaryAliasesRead(context));

		expect(hits.map((h) => `${h.line} ${h.alias}`)).toEqual([
			"4 push",
			"4 item",
			"12 real-time event",
		]);
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
});
