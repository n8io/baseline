import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agentDocsViolationsRead } from "../apps/app/agent-docs-test-rules.ts";

// The Template's structure test checks its own AGENTS.md; this runs the same check on the root
// one, which every task in baseline loads with the glossary it imports.
const repoRoot = new URL("../", import.meta.url);
const agentDocsBudget = { agentsMaxBytes: 4000, loadedMaxBytes: 6000 };

describe("agent docs", () => {
	it("keeps the root AGENTS.md small, with imports and links that resolve", () => {
		const docPaths = readdirSync(new URL("docs/agents/", repoRoot)).map(
			(name) => `docs/agents/${name}`,
		);
		expect(docPaths.length).toBeGreaterThan(0);
		expect(
			agentDocsViolationsRead(
				repoRoot,
				docPaths,
				(url) =>
					existsSync(url) && statSync(url).isFile()
						? readFileSync(url, "utf8")
						: undefined,
				agentDocsBudget,
			),
		).toEqual([]);
	});
});
