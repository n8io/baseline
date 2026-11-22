import { describe, expect, it } from "vitest";
import { conflictOwnLines } from "./conflict-report.ts";

describe("conflictOwnLines", () => {
	it("lists the Project's lines the Template's side lacks", () => {
		const text = [
			"keep",
			"<<<<<<< HEAD",
			'import { parseArgs } from "node:util";',
			'import { join } from "node:path";',
			"=======",
			'import { join } from "node:path";',
			">>>>>>> abc (template 2.0.0)",
			"after",
		].join("\n");
		expect(conflictOwnLines(text)).toEqual([
			'import { parseArgs } from "node:util";',
		]);
	});

	it("ignores a diff3 base and blank lines, and reads several blocks", () => {
		const text = [
			"<<<<<<< HEAD",
			"mine",
			"",
			"||||||| base",
			"old",
			"=======",
			"theirs",
			">>>>>>> x",
			"<<<<<<< HEAD",
			"also mine",
			"=======",
			">>>>>>> x",
		].join("\n");
		expect(conflictOwnLines(text)).toEqual(["mine", "also mine"]);
	});

	it("is empty without markers", () => {
		expect(conflictOwnLines("a\nb\n")).toEqual([]);
	});
});
