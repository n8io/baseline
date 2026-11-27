import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (file: string) =>
	readFileSync(join(root, ".github/workflows", file), "utf8");

const tagStepRead = (): string => {
	const match =
		/- if: steps\.changesets\.outputs\.has-changesets == 'false'\n {8}run: \|\n((?: {10}.*\n?)+)/.exec(
			read("release.yml"),
		);
	expect(match, "the tag step in release.yml").not.toBeNull();

	return (match?.[1] ?? "").replace(/^ {10}/gm, "");
};

const git = (cwd: string, ...args: string[]) =>
	execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

// A bare origin and a clone with commits c1..c3; `tags` maps a tag to the commit it sits on.
const setup = (tags: Record<string, string>) => {
	const dir = mkdtempSync(join(tmpdir(), "release-tag-"));
	const origin = join(dir, "origin.git");
	const work = join(dir, "work");
	mkdirSync(work);
	git(dir, "init", "-q", "--bare", origin);
	git(work, "init", "-q", "-b", "main");
	git(work, "config", "user.email", "t@example.com");
	git(work, "config", "user.name", "t");
	git(work, "remote", "add", "origin", origin);
	const shas: Record<string, string> = {};
	for (const label of ["c1", "c2", "c3"]) {
		writeFileSync(join(work, label), label);
		git(work, "add", ".");
		git(work, "commit", "-q", "-m", label);
		shas[label] = git(work, "rev-parse", "HEAD");
	}
	for (const [tag, label] of Object.entries(tags)) {
		git(work, "tag", tag, shas[label] ?? "");
	}
	git(work, "push", "-q", "origin", "main", "--tags");

	return { origin, shas, work };
};

const runStep = (work: string) =>
	execFileSync("bash", ["-eu", "-c", tagStepRead()], {
		cwd: work,
		encoding: "utf8",
		stdio: "pipe",
	});

describe("release.yml moves the major tag", () => {
	it("pushes with a lease, never a plain force", () => {
		const step = tagStepRead();
		expect(step).toContain('--force-with-lease="refs/tags/$major:$old"');
		expect(step).not.toMatch(/push --force /);
	});

	it("moves v1 forward to the newest app@1 tag", () => {
		const { origin, shas, work } = setup({
			"app@1.0.0": "c1",
			"app@1.1.0": "c3",
			v1: "c1",
		});
		runStep(work);
		expect(git(origin, "rev-parse", "refs/tags/v1^{commit}")).toBe(shas["c3"]);
	});

	it("creates v1 when it is missing", () => {
		const { origin, shas, work } = setup({ "app@1.0.0": "c2" });
		runStep(work);
		expect(git(origin, "rev-parse", "refs/tags/v1^{commit}")).toBe(shas["c2"]);
	});

	it("does not move v1 back when it is already ahead of the newest app@1 tag", () => {
		const { origin, shas, work } = setup({ "app@1.0.0": "c1", v1: "c3" });
		runStep(work);
		expect(git(origin, "rev-parse", "refs/tags/v1^{commit}")).toBe(shas["c3"]);
	});

	it("moves only the newest tag's major and leaves a lower major alone", () => {
		const { origin, shas, work } = setup({
			"app@1.4.0": "c2",
			"app@2.0.0": "c3",
			v1: "c2",
		});
		runStep(work);
		expect(git(origin, "rev-parse", "refs/tags/v2^{commit}")).toBe(shas["c3"]);
		expect(git(origin, "rev-parse", "refs/tags/v1^{commit}")).toBe(shas["c2"]);
	});

	it("ignores app@0 tags", () => {
		const { origin, work } = setup({ "app@0.9.0": "c3" });
		runStep(work);
		expect(git(origin, "tag", "--list", "v*")).toBe("");
	});
});

describe("ci-recover.yml records a rerun", () => {
	const recover = read("ci-recover.yml");

	it("writes the failed job names to the job summary, then reruns them", () => {
		const step =
			/- if: env\.ATTEMPT == '1'\n {8}run: \|\n((?: {10}.*\n)+)/.exec(
				recover,
			)?.[1] ?? "";
		expect(step).toContain("$GITHUB_STEP_SUMMARY");
		expect(step).toContain('gh run rerun "$RUN_ID" --failed --repo "$REPO"');
		expect(step.indexOf("$GITHUB_STEP_SUMMARY")).toBeLessThan(
			step.indexOf("gh run rerun"),
		);
	});

	it("tracks each rerun job as a flake issue before rerunning it", () => {
		const step =
			/- if: env\.ATTEMPT == '1'\n {8}run: \|\n((?: {10}.*\n)+)/.exec(
				recover,
			)?.[1] ?? "";
		expect(step).toContain("--label flake");
		expect(step).toContain("gh issue create");
		expect(step).toContain("gh issue comment");
		expect(step.indexOf("--label flake")).toBeLessThan(
			step.indexOf("gh run rerun"),
		);
	});

	it("keeps the permissions it had", () => {
		expect(recover).toContain(
			"\npermissions:\n  actions: write\n  contents: read\n  issues: write\n\njobs:",
		);
	});
});
