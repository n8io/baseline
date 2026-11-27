import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// GitHub Actions cannot share a `services:` block or a job container across files, and app-ci.yml
// (called by Projects) cannot call back into ci.yml or a sibling file by a relative path. ci.yml calls
// integration.yml and sast.yml, which hold the template-as-is jobs once; app-ci.yml keeps its own
// copies of the same blocks, and these tests fail when those copies drift.

const root = resolve(import.meta.dirname, "..");
const read = (file: string) =>
	readFileSync(join(root, ".github/workflows", file), "utf8");

// The lines from `<key>:` to the next line indented the same or less, minus comment lines.
const blockRead = (workflow: string, key: string): string => {
	const lines = workflow.split("\n");
	const start = lines.findIndex((line) => line.trim() === `${key}:`);
	expect(start, `${key}: in the workflow`).toBeGreaterThanOrEqual(0);
	const indent = (lines[start] ?? "").search(/\S/);
	const end = lines.findIndex(
		(line, index) =>
			index > start && line.trim() !== "" && line.search(/\S/) <= indent,
	);

	return lines
		.slice(start, end === -1 ? undefined : end)
		.filter((line) => !line.trim().startsWith("#"))
		.join("\n");
};

const semgrepImageRead = (workflow: string) =>
	/^\s*container: (semgrep\/semgrep:\S+@sha256:[0-9a-f]{64})$/m.exec(
		workflow,
	)?.[1];

describe("blocks that ci.yml's reusable workflows and app-ci.yml both carry", () => {
	it("ci.yml runs the template-as-is jobs through the reusable workflows, not inline", () => {
		const ci = read("ci.yml");
		expect(ci).toMatch(
			/\n {2}integration:\n(?: {4}.*\n)*? {4}uses: \.\/\.github\/workflows\/integration\.yml\n/,
		);
		expect(ci).toMatch(
			/\n {2}sast:\n(?: {4}.*\n)*? {4}uses: \.\/\.github\/workflows\/sast\.yml\n/,
		);
		expect(ci).not.toMatch(/^\s*services:$/m);
		expect(semgrepImageRead(ci)).toBeUndefined();
	});

	it("the integration jobs use the same Postgres and Redis services", () => {
		expect(blockRead(read("integration.yml"), "services")).toBe(
			blockRead(read("app-ci.yml"), "services"),
		);
	});

	it("the sast jobs run the same Semgrep image, digest included", () => {
		expect(semgrepImageRead(read("sast.yml"))).toBeDefined();
		expect(semgrepImageRead(read("sast.yml"))).toBe(
			semgrepImageRead(read("app-ci.yml")),
		);
	});
});
