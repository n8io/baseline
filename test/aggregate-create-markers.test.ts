import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { aggregateParts } from "../apps/app/scripts/aggregate-create.ts";

// Foo marks the lines of an aggregate-create part (`--schedule`, `--seed`) that sit inside shared files
// with `aggregate-create-start: <part>` / `aggregate-create-end: <part>`. Like piece blocks, each is code a
// reader skips past, so they have a budget, beside the piece markers' in piece-markers.test.ts.
// Raise it only on purpose: 9 since the stale cut-off moved into domain/foo.ts (#468).
const blocksMax = 9;

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

// [path, kind, part] for every marker line, in file order.
const markersRead = (): [path: string, kind: string, part: string][] =>
	execFileSync(
		"git",
		[
			"grep",
			"-E",
			"--null",
			"-n",
			"^[[:space:]]*// aggregate-create-(start|end): ",
			"--",
			"apps/app/src",
		],
		{ cwd: repoRoot, encoding: "utf8" },
	)
		.trim()
		.split("\n")
		.map((line) => {
			const [path = "", , text = ""] = line.split("\0");
			const [, kind = "", part = ""] =
				/aggregate-create-(start|end): (\S+)/.exec(text) ?? [];
			return [path, kind, part];
		});

describe("aggregate-create part markers in the Template", () => {
	const markers = markersRead();

	it(`stay at ${blocksMax} blocks or fewer`, () => {
		const starts = markers.filter(([, kind]) => kind === "start");
		expect(starts.length).toBeGreaterThan(0);
		expect(starts.length).toBeLessThanOrEqual(blocksMax);
	});

	it("name a part aggregate-create knows, and close each block before the next opens", () => {
		const open = new Map<string, string>();
		const wrong = markers.filter(([path, kind, part]) => {
			const known = (aggregateParts as readonly string[]).includes(part);
			const ok =
				known && (kind === "start" ? !open.has(path) : open.get(path) === part);
			if (kind === "start") open.set(path, part);
			else open.delete(path);
			return !ok;
		});
		expect(wrong).toEqual([]);
		expect([...open.keys()]).toEqual([]);
	});
});
