import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// CONTEXT.md (Release) and docs/agents/release.md (step 7) both say when `v<major>` moves, and
// release.yml does it. They must say the same: in the run that follows the publish, once no
// changesets are left, to the newest `app@` tag.
const root = resolve(import.meta.dirname, "..");
const read = (file: string): string => readFileSync(join(root, file), "utf8");

const releaseEntry =
	/\*\*Release\*\*:\n(.*)\n/.exec(read("CONTEXT.md"))?.[1] ?? "";
const step =
	/\n7\. \*\*`v<major>` moves\.\*\* (.*)\n/.exec(
		read("docs/agents/release.md"),
	)?.[1] ?? "";
const workflow = read(".github/workflows/release.yml");

describe("when v<major> moves", () => {
	it("reads both docs", () => {
		expect(releaseEntry).not.toBe("");
		expect(step).not.toBe("");
	});

	it("is the same release.yml run in both docs", () => {
		expect(releaseEntry).toContain("the same `release.yml` run");
		expect(step).toContain("The same `release.yml` run");
	});

	it("points at the newest app@ tag in both docs", () => {
		expect(releaseEntry).toMatch(/`v<major>`.*newest `app@` tag/);
		expect(step).toMatch(/`v<major>` tag at the newest `app@<major>\.x\.y`/);
	});

	it("waits for no changesets left, as release.yml does", () => {
		expect(step).toContain("no changesets left");
		expect(workflow).toContain(
			"steps.changesets.outputs.has-changesets == 'false'",
		);
	});
});
