import { describe, expect, it } from "vitest";
import { kickoffWrite } from "../scripts/kickoff.ts";

const input = {
	context: "/mnt/project-files/x/context.md",
	gates: "pnpm check",
	issue: 7,
	owns: "src/a.ts",
	repo: "n8io/baseline",
	size: 1500,
	title: "Do a thing",
};

describe("kickoff", () => {
	it("names the issue, context and owned files, and never asks for Fable", () => {
		const text = kickoffWrite(input);
		expect(text).toContain('n8io/baseline#7 "Do a thing"');
		expect(text).toContain("/mnt/project-files/x/context.md");
		expect(text).toContain("Owns: src/a.ts.");
		expect(text).toContain("Never Fable");
		expect(text).not.toMatch(/model fable|Fable 5\.2/);
	});

	it("leaves out Owns when none is given", () => {
		expect(kickoffWrite({ ...input, owns: null })).not.toContain("Owns:");
	});
});
