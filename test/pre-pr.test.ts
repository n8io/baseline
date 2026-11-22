import { describe, expect, it } from "vitest";
import { prPreCheck } from "../scripts/pre-pr.ts";

const file = (path: string, added = 1, deleted = 0) => ({
	added,
	deleted,
	path,
});

describe("pre-pr", () => {
	it("fails a diff over 1,500 lines and ignores lockfiles and changelogs", () => {
		const big = prPreCheck([file("apps/app/src/a.ts", 1600)]);
		expect(big[0]?.level).toBe("fail");
		const generated = prPreCheck([
			file("pnpm-lock.yaml", 5000),
			file("packages/x/CHANGELOG.md", 900),
			file("apps/app/src/a.ts", 10),
		]);
		expect(generated[0]).toEqual({ level: "ok", text: "10 changed lines" });
	});

	it("warns when a Package's source changed without a changeset", () => {
		expect(prPreCheck([file("packages/queue/src/a.ts")])[1]?.level).toBe(
			"warn",
		);
		expect(
			prPreCheck([
				file("packages/queue/src/a.ts"),
				file(".changeset/quiet-owls-sing.md"),
			])[1]?.level,
		).toBe("ok");
		expect(prPreCheck([file("packages/queue/src/a.test.ts")])[1]?.level).toBe(
			"ok",
		);
	});

	it("skips the model review for a Markdown-only diff", () => {
		expect(prPreCheck([file("docs/a.md")])[2]?.text).toContain("skip");
		expect(
			prPreCheck([file("docs/a.md"), file("scripts/b.ts")])[2]?.text,
		).toContain("Sonnet");
	});
});
