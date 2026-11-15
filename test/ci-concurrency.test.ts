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
		expect(ci).toContain(
			"\n  push:\n    branches: [main]\n  workflow_dispatch:\n",
		);
		expect(ci).not.toMatch(/uses: actions\/cache@/);
		expect(ci).not.toContain("github.event_name == 'push'");
		expect(ci).not.toContain("github.event_name != 'push'");
		expect(ci).toMatch(
			/- if: github\.ref == 'refs\/heads\/main'\n {8}uses: actions\/cache\/save@/,
		);
		expect(ci.match(/uses: actions\/cache\/save@/g)).toHaveLength(1);
		expect(ci).toMatch(
			/- if: github\.ref != 'refs\/heads\/main'\n {8}uses: actions\/cache\/restore@/,
		);
		expect(ci).toContain(
			"\n  automerge:\n    if: github.event_name == 'pull_request'\n",
		);
	});

	// A GITHUB_TOKEN push starts no workflow, a GITHUB_TOKEN dispatch always does.
	it("baseline starts its run on main after a Dependabot merge, which a push cannot", () => {
		const ci = read(".github/workflows/ci.yml");
		const job = ci.slice(ci.indexOf("\n  main-run:\n"));
		expect(job).toContain(
			"\n    if: github.event.pull_request.user.login == 'dependabot[bot]'\n    needs: automerge\n",
		);
		expect(job).toContain(
			"\n    permissions:\n      actions: write\n      pull-requests: read\n",
		);
		expect(job).toMatch(
			/--jq \.merged\)" = true \]; then\n {12}gh workflow run ci\.yml --ref main\n/,
		);
	});

	it("dependabot-automerge.yml asks Projects for no new permission", () => {
		const automerge = read(".github/workflows/dependabot-automerge.yml");
		expect(automerge).toContain("\non:\n  workflow_call:\n\n");
		expect(automerge).toContain(
			"\n    permissions:\n      contents: write\n      pull-requests: write\n    steps:",
		);
		expect(automerge).not.toContain("actions:");
	});

	it("the Template's run never starts on push, which a private Project pays for", () => {
		expect(read("apps/app/.github/workflows/ci.yml")).toContain(
			"\non: [pull_request, workflow_dispatch]\n",
		);
	});

	it("checks out without keeping the token, since no ci job pushes", () => {
		const ci = read(".github/workflows/ci.yml");
		const checkouts = ci.match(/uses: actions\/checkout@.*\n(?: {8}.*\n)*/g);
		expect(checkouts?.length).toBeGreaterThan(0);
		for (const checkout of checkouts ?? [])
			expect(checkout).toContain("persist-credentials: false");
	});
});
