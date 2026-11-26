import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// GitHub Actions cannot share a `services:` block or a job container across files, and app-ci.yml
// (called by Projects) cannot call back into ci.yml. app-ci.yml is the source; ci.yml repeats the
// blocks for the template-as-is jobs, and these tests fail when the copies drift.

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

describe("blocks that ci.yml and app-ci.yml both carry", () => {
	it("the integration jobs use the same Postgres and Redis services", () => {
		expect(blockRead(read("ci.yml"), "services")).toBe(
			blockRead(read("app-ci.yml"), "services"),
		);
	});

	it("the sast jobs run the same Semgrep image, digest included", () => {
		const containerRead = (workflow: string) =>
			/^\s*container: (semgrep\/semgrep:\S+@sha256:[0-9a-f]{64})$/m.exec(
				workflow,
			)?.[1];

		expect(containerRead(read("ci.yml"))).toBeDefined();
		expect(containerRead(read("ci.yml"))).toBe(
			containerRead(read("app-ci.yml")),
		);
	});
});
