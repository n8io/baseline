import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { modelOptions } from "../apps/app/scripts/model-create.ts";

// Foo marks the lines of a model-create option (`--schedule`, `--seed`) that sit inside shared files
// with `model-create-start: <option>` / `model-create-end: <option>`. Like piece blocks, each is code a
// reader skips past, so they have a budget, beside the piece markers' in piece-markers.test.ts.
// Raise it only on purpose: 9 since the stale cut-off moved into domain/foo.ts (#468).
const blocksMax = 9;

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

// [path, kind, option] for every marker line, in file order.
const markersRead = (): [path: string, kind: string, option: string][] =>
	execFileSync(
		"git",
		[
			"grep",
			"-E",
			"--null",
			"-n",
			"^[[:space:]]*// model-create-(start|end): ",
			"--",
			"apps/app/src",
		],
		{ cwd: repoRoot, encoding: "utf8" },
	)
		.trim()
		.split("\n")
		.map((line) => {
			const [path = "", , text = ""] = line.split("\0");
			const [, kind = "", option = ""] =
				/model-create-(start|end): (\S+)/.exec(text) ?? [];
			return [path, kind, option];
		});

describe("model-create option markers in the Template", () => {
	const markers = markersRead();

	it(`stay at ${blocksMax} blocks or fewer`, () => {
		const starts = markers.filter(([, kind]) => kind === "start");
		expect(starts.length).toBeGreaterThan(0);
		expect(starts.length).toBeLessThanOrEqual(blocksMax);
	});

	it("name an option model-create knows, and close each block before the next opens", () => {
		const open = new Map<string, string>();
		const wrong = markers.filter(([path, kind, option]) => {
			const known = (modelOptions as readonly string[]).includes(option);
			const ok =
				known &&
				(kind === "start" ? !open.has(path) : open.get(path) === option);
			if (kind === "start") open.set(path, option);
			else open.delete(path);
			return !ok;
		});
		expect(wrong).toEqual([]);
		expect([...open.keys()]).toEqual([]);
	});
});
