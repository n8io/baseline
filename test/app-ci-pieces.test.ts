import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { pieceNames } from "../apps/app/scripts/pieces.ts";

const workflow = readFileSync(
	join(resolve(import.meta.dirname, ".."), ".github/workflows/app-ci.yml"),
	"utf8",
);

describe("app-ci.yml pieces", () => {
	it("checks every Piece in its own job, so the check stays fast as Pieces are added", () => {
		const matrix =
			/^ {2}piece:\n[\s\S]*?matrix:\n {8}piece:\n((?: {10}- .+\n)+)/m.exec(
				workflow,
			);
		expect(matrix).not.toBeNull();
		const listed = [...(matrix?.[1] ?? "").matchAll(/- (\S+)/g)].map(
			(m) => m[1],
		);
		expect(listed).toEqual([...pieceNames]);
	});

	it("skips the piece jobs on a pull request that cannot change a piece removal", () => {
		expect(workflow).toMatch(
			/^ {2}piece:\n[\s\S]*?if: .*needs\.changes\.outputs\.pieces != 'false'/m,
		);
		expect(workflow).toMatch(
			/pieces: \$\{\{ steps\.diff\.outputs\.pieces \}\}/,
		);
	});

	it("keeps `pieces` as the one aggregate job the ruleset requires", () => {
		expect(workflow).toMatch(/^ {2}pieces:\n {4}needs: piece\n/m);
	});
});
