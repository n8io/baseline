import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	semgrepRuleIdsRead,
	semgrepRulePathsRead,
} from "../scripts/semgrep-rules-write.ts";

const root = resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");

describe("the sast jobs' Semgrep rules", () => {
	it.each([".github/workflows/app-ci.yml", ".github/workflows/sast.yml"])(
		"%s scans with the pinned snapshot, never a live registry pack",
		(file) => {
			const workflow = read(file);
			expect(workflow).not.toMatch(/--config\s+p\//);
			expect(workflow).toContain(
				'semgrep scan --error --metrics=off --no-rewrite-rule-ids --config "$RUNNER_TEMP/semgrep-rules"',
			);
			expect(workflow).toMatch(
				/sh "?\S*rules\.sh"? "?\S*rules\.txt"? "\$RUNNER_TEMP\/semgrep-rules"/,
			);
		},
	);

	it("app-ci fetches the snapshot from its own commit of baseline", () => {
		expect(read(".github/workflows/app-ci.yml")).toContain(
			`PIN: https://raw.githubusercontent.com/\${{ job.workflow_repository }}/\${{ job.workflow_sha }}/.github/semgrep`,
		);
	});

	it("rules.txt pins one semgrep-rules commit and rule count, and lists each rule file once, sorted", () => {
		const lines = read(".github/semgrep/rules.txt").trimEnd().split("\n");
		expect(lines.filter((line) => line.startsWith("commit "))).toEqual([
			expect.stringMatching(/^commit [0-9a-f]{40}$/),
		]);
		expect(lines.filter((line) => line.startsWith("rules "))).toEqual([
			expect.stringMatching(/^rules [1-9]\d*$/),
		]);
		const paths = lines.filter((line) => !/^(#|commit |rules )/.test(line));
		expect(paths.length).toBeGreaterThan(0);
		expect(paths.every((path) => /^[\w./-]+\.ya?ml$/.test(path))).toBe(true);
		expect(paths).toEqual([...new Set(paths)].sort());
	});
});

describe("semgrepRuleIdsRead", () => {
	it("reads rule ids from the registry's YAML and its JSON", () => {
		const yaml = [
			"rules:",
			"- id: javascript.jose.security.jwt-hardcode.hardcoded-jwt-secret",
			"  message: x",
			"  metadata:",
			"    references:",
			"    - id: not-a-rule",
		].join("\n");
		expect(semgrepRuleIdsRead(yaml)).toEqual([
			"javascript.jose.security.jwt-hardcode.hardcoded-jwt-secret",
		]);
		expect(
			semgrepRuleIdsRead('{"rules":[{"id":"generic.secrets.a.b"}]}'),
		).toEqual(["generic.secrets.a.b"]);
	});
});

describe("semgrepRulePathsRead", () => {
	it("finds each rule's file, .yaml or .yml, once per file", () => {
		expect(
			semgrepRulePathsRead({
				ids: [
					"typescript.aws-cdk.security.awscdk-codebuild.rule-one",
					"javascript.jose.security.jwt-hardcode.rule-one",
					"javascript.jose.security.jwt-hardcode.rule-two",
				],
				tree: [
					"javascript/jose/security/jwt-hardcode.js",
					"javascript/jose/security/jwt-hardcode.yaml",
					"typescript/aws-cdk/security/awscdk-codebuild.yml",
				],
			}),
		).toEqual([
			"javascript/jose/security/jwt-hardcode.yaml",
			"typescript/aws-cdk/security/awscdk-codebuild.yml",
		]);
	});

	it("refuses a rule whose file the pinned commit does not have", () => {
		expect(() =>
			semgrepRulePathsRead({ ids: ["javascript.gone.rule"], tree: [] }),
		).toThrow("no rule file in semgrep-rules for javascript.gone.rule");
	});
});
