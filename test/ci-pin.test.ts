import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	ciPinFiles,
	ciPinRewrite,
	ciPinsRead,
	templateMajorRead,
} from "../scripts/ci-pin-write.ts";

const root = resolve(import.meta.dirname, "..");

describe("the Template's app-ci pin", () => {
	it.each(ciPinFiles)(
		"%s calls baseline's workflows at the Template's major",
		(file) => {
			const pins = ciPinsRead(readFileSync(join(root, file), "utf8"));
			expect(pins.length).toBeGreaterThan(0);
			expect(pins).toEqual(pins.map(() => templateMajorRead(root)));
		},
	);

	it("never edits the repo's own workflows, which the release App's token may not push", () => {
		expect(ciPinFiles.filter((file) => file.startsWith(".github/"))).toEqual(
			[],
		);
		const header = readFileSync(
			join(root, ".github/workflows/app-ci.yml"),
			"utf8",
		);
		expect(ciPinsRead(header)).toEqual([]);
	});

	it("moves with every Template version (`pnpm run version`)", () => {
		const { scripts } = JSON.parse(
			readFileSync(join(root, "package.json"), "utf8"),
		) as { scripts: Record<string, string> };
		expect(scripts.version).toMatch(
			/^changeset version && node scripts\/ci-pin-write\.ts && /,
		);
	});

	it("rewrites every baseline workflow pin and nothing else", () => {
		const text = [
			"    uses: n8io/baseline/.github/workflows/app-ci.yml@v6",
			"    uses: n8io/baseline/.github/workflows/dependabot-automerge.yml@v6",
			"      - uses: actions/checkout@v6",
		].join("\n");
		expect(ciPinRewrite(text, 8)).toBe(
			[
				"    uses: n8io/baseline/.github/workflows/app-ci.yml@v8",
				"    uses: n8io/baseline/.github/workflows/dependabot-automerge.yml@v8",
				"      - uses: actions/checkout@v6",
			].join("\n"),
		);
	});
});
