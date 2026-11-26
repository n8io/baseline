import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const workflow = readFileSync(
	join(root, ".github/workflows/app-ci.yml"),
	"utf8",
);

describe("app-ci.yml glossary step", () => {
	const start = workflow.indexOf("- name: Glossary hits in added lines");
	const step = workflow.slice(start, workflow.indexOf("\n\n", start));

	it("runs pnpm glossary-check in a Project, where the checkout has a git base", () => {
		expect(start).toBeGreaterThan(-1);
		expect(step).toContain("run: pnpm glossary-check");
		expect(step).toContain("inputs.artifact == ''");
	});

	it("blocks: no continue-on-error", () => {
		expect(step).not.toContain("continue-on-error");
	});
});
