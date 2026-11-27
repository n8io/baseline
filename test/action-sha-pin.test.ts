import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const workflowsDir = join(root, ".github/workflows");

// A workflow runs an action's code with the repo's token, so an action is pinned to a full commit SHA:
// a tag or branch can move under the workflow. A local action (`./`) lives in this repo and a
// `docker://` image is pinned by digest elsewhere, so neither needs a SHA here.
const usesLineOf = /^\s*(?:-\s+)?uses:\s*(.*)$/;
const exemptFromSha = /^(?:\.\/|docker:\/\/)/;
const shaPinned = /^[\w.-]+(?:\/[\w.-]+)+@[0-9a-f]{40}$/;

const workflowFiles = () =>
	readdirSync(workflowsDir)
		.filter((name) => /\.ya?ml$/.test(name))
		.sort()
		.map((name) => `.github/workflows/${name}`);

const unpinnedUsesOf = (file: string, source: string): string[] =>
	source.split("\n").flatMap((line, index) => {
		const reference = usesLineOf
			.exec(line)?.[1]
			?.replace(/\s+#.*$/, "")
			.trim();
		if (
			reference === undefined ||
			exemptFromSha.test(reference) ||
			shaPinned.test(reference)
		) {
			return [];
		}
		return [
			`${file}:${index + 1}: uses: ${reference} is not pinned to a 40-character commit SHA (owner/repo@<sha>)`,
		];
	});

describe("GitHub Actions uses: references", () => {
	it("flags a reference that is not pinned to a full commit SHA", () => {
		const find = (source: string) => unpinnedUsesOf("x.yml", source);
		const sha = "3d3c42e5aac5ba805825da76410c181273ba90b1";
		expect(find(`      - uses: actions/checkout@${sha} # v7.0.1`)).toEqual([]);
		expect(find(`        uses: actions/checkout@${sha}`)).toEqual([]);
		expect(
			find(`      - uses: github/codeql-action/upload-sarif@${sha}`),
		).toEqual([]);
		expect(find("    uses: ./.github/workflows/app-ci.yml")).toEqual([]);
		expect(find("      - uses: docker://alpine:3.20")).toEqual([]);
		expect(find("#       uses: n8io/baseline/app-ci.yml@v18")).toEqual([]);
		expect(find("      - uses: actions/checkout@v7")).toHaveLength(1);
		expect(find("      - uses: actions/checkout")).toHaveLength(1);
		expect(
			find(`      - uses: actions/checkout@${sha.slice(0, 39)}`),
		).toHaveLength(1);
		expect(
			find(`      - uses: actions/checkout@${sha.toUpperCase()}`),
		).toHaveLength(1);
		expect(find("      - uses: actions/checkout@main # v7")).toHaveLength(1);
		expect(find("      - uses:")).toHaveLength(1);
	});

	it("names the file, line number and reference of each unpinned line", () => {
		const source =
			"jobs:\n  a:\n    steps:\n      - uses: actions/setup-node@v7\n";
		expect(unpinnedUsesOf(".github/workflows/ci.yml", source)).toEqual([
			".github/workflows/ci.yml:4: uses: actions/setup-node@v7 is not pinned to a 40-character commit SHA (owner/repo@<sha>)",
		]);
	});

	it("pins every uses: reference in .github/workflows", () => {
		const files = workflowFiles();
		expect(files.length).toBeGreaterThan(0);
		expect(
			files.flatMap((file) =>
				unpinnedUsesOf(file, readFileSync(join(root, file), "utf8")),
			),
		).toEqual([]);
	});
});
