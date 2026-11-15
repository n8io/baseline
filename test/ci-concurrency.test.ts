import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");

// A run on main gets its run id as its group, so a newer run on main never cancels it.
const concurrency = [
	"concurrency:",
	`  group: ci-\${{ github.ref == 'refs/heads/main' && github.run_id || github.ref }}`,
	"  cancel-in-progress: true",
].join("\n");

describe("ci.yml runs", () => {
	it.each([".github/workflows/ci.yml", "apps/app/.github/workflows/ci.yml"])(
		"%s cancels a superseded run on its ref, never one on main",
		(file) => {
			expect(read(file)).toContain(`\n${concurrency}\n`);
		},
	);

	it("baseline's run on main tests main and alone saves the Turborepo cache", () => {
		const ci = read(".github/workflows/ci.yml");
		expect(ci).toContain("\n  push:\n    branches: [main]\n");
		expect(ci).not.toMatch(/uses: actions\/cache@/);
		expect(ci).toMatch(
			/- if: github\.event_name == 'push'\n {8}uses: actions\/cache\/save@/,
		);
		expect(ci.match(/uses: actions\/cache\/save@/g)).toHaveLength(1);
	});

	it("checks out without keeping the token, since no ci job pushes", () => {
		const ci = read(".github/workflows/ci.yml");
		const checkouts = ci.match(/uses: actions\/checkout@.*\n(?: {8}.*\n)*/g);
		expect(checkouts?.length).toBeGreaterThan(0);
		for (const checkout of checkouts ?? [])
			expect(checkout).toContain("persist-credentials: false");
	});
});
