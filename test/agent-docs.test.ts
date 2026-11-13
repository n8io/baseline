import { describe, expect, it } from "vitest";
import { agentDocsViolationsRead } from "../apps/app/agent-docs-test-rules.ts";

// The Template's structure test checks its own AGENTS.md; this runs the same check on the root
// one, which every task in baseline loads.
describe("agent docs", () => {
	it("keeps the root AGENTS.md small, with imports and links that resolve", () => {
		expect(
			agentDocsViolationsRead(new URL("../", import.meta.url), 4000),
		).toEqual([]);
	});
});
