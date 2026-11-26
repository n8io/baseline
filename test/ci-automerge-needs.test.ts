import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// dependabot-automerge.yml runs "after every CI job passes". A job that ci.yml's automerge does not
// need can still be running when automerge merges, so this lists the jobs and fails on a miss.

const root = resolve(import.meta.dirname, "..");
const ci = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");

// Job names under `jobs:`: two-space keys, comment lines ignored.
const jobsRead = (workflow: string): string[] => {
	const body = workflow.slice(workflow.indexOf("\njobs:\n") + 1);

	return [...body.matchAll(/^ {2}([a-z][\w-]*):\s*$/gm)].map((m) => m[1] ?? "");
};

// The names in `needs: [a, b]` or `needs: a` of one job, flow lists wrapped over lines included.
const needsRead = (workflow: string, job: string): string[] => {
	const body = workflow.slice(workflow.indexOf(`\n  ${job}:\n`));
	const next = body.slice(3 + job.length).search(/^ {2}[a-z][\w-]*:\s*$/m);
	const block = next === -1 ? body : body.slice(0, next + 3 + job.length);
	const needs = /^ {4}needs:\s*(\[[^\]]*\]|\S+)/m.exec(block)?.[1] ?? "";

	return needs
		.replace(/[[\]]/g, "")
		.split(",")
		.map((name) => name.trim())
		.filter((name) => name !== "");
};

// automerge is the gate itself, and main-run waits on automerge.
const exempt = new Set(["automerge", "main-run"]);

describe("ci.yml automerge", () => {
	it("needs every job the pipeline defines", () => {
		const jobs = jobsRead(ci).filter((job) => !exempt.has(job));
		const needs = needsRead(ci, "automerge");

		expect(jobs).toContain("render-and-test");
		expect(jobs.filter((job) => !needs.includes(job))).toEqual([]);
	});

	it("needs no job ci.yml does not define", () => {
		const jobs = jobsRead(ci);

		expect(needsRead(ci, "automerge").filter((n) => !jobs.includes(n))).toEqual(
			[],
		);
	});

	it("calls app-ci.yml through render-and-test, so its jobs finish first", () => {
		expect(ci).toMatch(
			/\n {2}render-and-test:\n(?: {4}.*\n)*? {4}uses: \.\/\.github\/workflows\/app-ci\.yml\n/,
		);
	});
});
