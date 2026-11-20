import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The Template's glossary repeats four of the root glossary's terms in its "Baseline" section,
// because a Project has no root CONTEXT.md. Their definitions are worded for each reader, but an
// alias banned in one must be banned in the other.
const root = new URL("../", import.meta.url);
const terms = ["Package", "Project", "Template", "Template upgrade"];

const avoidRead = (path: string, term: string) => {
	const text = readFileSync(new URL(path, root), "utf8");
	const entry = text.split(`\n**${term}**:\n`)[1]?.split("\n\n")[0] ?? "";
	return entry.split("\n").find((line) => line.startsWith("_Avoid_:"));
};

describe("baseline glossary terms", () => {
	it.each(terms)("bans the same aliases for %s in both glossaries", (term) => {
		const rootAvoid = avoidRead("CONTEXT.md", term);
		expect(rootAvoid).toMatch(/^_Avoid_: /);
		expect(avoidRead("apps/app/CONTEXT.md", term)).toBe(rootAvoid);
	});
});
