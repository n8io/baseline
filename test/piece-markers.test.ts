import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Every `piece-start:` block is code a reader has to skip past, so the Template keeps few of them:
// a piece prefers whole files, and the count has a budget. Raise a limit only on purpose.
const markersMax = 91;
const markersPerFileMax = 6;
// It opens every piece, one block each.
const markersPerFileAllowed: Record<string, number> = {
	"apps/app/src/connections.ts": 7,
};

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

// The marker line that piece-remove.ts deletes from; Markdown only describes markers.
const markerCounts = (): [path: string, count: number][] =>
	execFileSync(
		"git",
		[
			"grep",
			"-cE",
			"^[[:space:]]*(//|#) piece-start: ",
			"--",
			"apps/app",
			":!*.md",
		],
		{ cwd: repoRoot, encoding: "utf8" },
	)
		.trim()
		.split("\n")
		.map((line) => {
			const at = line.lastIndexOf(":");
			return [line.slice(0, at), Number(line.slice(at + 1))];
		});

describe("piece markers in the Template", () => {
	it(`stay at ${markersMax} or fewer`, () => {
		const total = markerCounts().reduce((sum, [, count]) => sum + count, 0);
		expect(total).toBeLessThanOrEqual(markersMax);
	});

	it(`stay at ${markersPerFileMax} or fewer per file`, () => {
		const over = markerCounts().filter(
			([path, count]) =>
				count > (markersPerFileAllowed[path] ?? markersPerFileMax),
		);
		expect(over).toEqual([]);
	});
});
