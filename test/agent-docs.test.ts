import { statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agentDocsViolationsRead } from "../apps/app/agent-docs-test-rules.ts";

// The Template's structure test checks its own AGENTS.md; this runs the same check on the root
// one, which every task in baseline loads. Its walkthroughs name the Template's commands too.
const root = new URL("../", import.meta.url);

describe("agent docs", () => {
	it("keeps the root AGENTS.md small, with imports, links and commands that resolve", () => {
		expect(
			agentDocsViolationsRead({
				agentsMaxBytes: 4000,
				commandRoots: [root, new URL("apps/app/", root)],
				root,
			}),
		).toEqual([]);
	});

	// The Template's AGENTS.md stays 1 KB under the 14,000-byte budget a Project's structure test
	// holds it to, so a Project has room for rules of its own.
	it("keeps the Template's AGENTS.md at or under 13,000 bytes", () => {
		expect(
			statSync(new URL("apps/app/AGENTS.md", root)).size,
		).toBeLessThanOrEqual(13_000);
	});
});
