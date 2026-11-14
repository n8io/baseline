import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// apps/app/docs/agents/bridges.md quotes the render test's second-domain fixture. Each ts block
// starts with `// <path>` and must appear, line for line, in that file: in fixture/files when the
// fixture adds the file, or in one hunk of wiring.patch when it changes a generated one. Indents
// are ignored: Biome dedents a quoted block.
const doc = new URL("../apps/app/docs/agents/bridges.md", import.meta.url);
const fixture = new URL("render/second-domain/", import.meta.url);

// The new side of each hunk wiring.patch makes to path, hunks apart.
const patchedRead = (path: string): string[] => {
	const patch = readFileSync(new URL("wiring.patch", fixture), "utf8");
	const hunks: string[] = [];
	let inFile = false;
	for (const line of patch.split("\n")) {
		if (line.startsWith("diff --git ")) {
			inFile = line === `diff --git a/${path} b/${path}`;
		} else if (inFile && line.startsWith("@@")) {
			hunks.push("");
		} else if (inFile && hunks.length > 0 && /^[ +]/.test(line)) {
			hunks[hunks.length - 1] += `${line.slice(1)}\n`;
		}
	}
	return hunks;
};

const indentsDrop = (text: string): string =>
	text
		.split("\n")
		.map((line) => line.trim())
		.join("\n");

const sourcesRead = (path: string): string[] => {
	const added = new URL(`files/${path}`, fixture);
	return existsSync(added) ? [readFileSync(added, "utf8")] : patchedRead(path);
};

const bridgesDocBlocksRead = (text: string) =>
	[...text.matchAll(/^```ts\n([\s\S]*?)^```$/gm)].map(([, body = ""]) => {
		const [first = "", ...rest] = body.split("\n");
		return {
			path: /^\/\/ (src\/\S+\.ts)$/.exec(first)?.[1],
			code: rest.join("\n"),
		};
	});

describe("docs/agents/bridges.md", () => {
	const blocks = bridgesDocBlocksRead(readFileSync(doc, "utf8"));

	it("quotes code in every ts block", () => {
		expect(blocks.length).toBeGreaterThan(0);
		expect(blocks.filter((b) => b.path === undefined)).toEqual([]);
	});

	it.each(blocks.map((b) => [b.path, b.code]))(
		"quotes %s as the fixture has it",
		(path, code) => {
			expect(code.trim()).not.toBe("");
			const sources = sourcesRead(path ?? "");
			expect(sources.length).toBeGreaterThan(0);
			expect(
				sources.some((source) =>
					indentsDrop(source).includes(indentsDrop(code)),
				),
			).toBe(true);
		},
	);
});
