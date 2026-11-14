import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { templateFileRender } from "../apps/app/scripts/template-render.ts";

// These apps/app/docs/agents pages quote the Template's Foo renamed to a `bar` Domain, because the
// render drops every line that names foo from a Project's copy. Each ts block starts with
// `// <path>` and, with bar read as foo, must appear line for line in apps/app/<path>. Indents are
// ignored: Biome dedents a quoted block.
const docs = ["schedules.md", "ui.md"];
const app = new URL("../apps/app/", import.meta.url);

const barAsFoo = (text: string): string =>
	text.replaceAll(/(bar|Bar|BAR)(?=s?(?![a-z]))/g, (name) =>
		name === "bar" ? "foo" : name === "Bar" ? "Foo" : "FOO",
	);

const indentsDrop = (text: string): string =>
	text
		.split("\n")
		.map((line) => line.trim())
		.join("\n");

const quotesRead = (text: string) =>
	[...text.matchAll(/^```tsx?\n([\s\S]*?)^```$/gm)].map(([, body = ""]) => {
		const [first = "", ...rest] = body.split("\n");
		return {
			code: rest.join("\n"),
			path: /^\/\/ (src\/\S+\.tsx?)$/.exec(first)?.[1],
		};
	});

describe.each(docs)("docs/agents/%s", (doc) => {
	const text = readFileSync(new URL(`docs/agents/${doc}`, app), "utf8");
	const quotes = quotesRead(text);

	it("reaches a Project whole: the render drops no line of it", () => {
		const path = `docs/agents/${doc}`;
		expect(
			templateFileRender({ path, text }, { description: "d", name: "n" }),
		).toEqual({ path, text });
	});

	// domain-create would wire into a file with a marker line, and piece-remove would cut it.
	it("holds no domain-create or piece marker line", () => {
		expect(
			text
				.split("\n")
				.filter((line) =>
					/^\s*(\/\/|#) (domain-create|piece-(start|end)):/.test(line),
				),
		).toEqual([]);
	});

	it("names the quoted file in every ts block", () => {
		expect(quotes.length).toBeGreaterThan(0);
		expect(quotes.filter((q) => q.path === undefined)).toEqual([]);
	});

	it.each(quotes.map((q) => [q.path, q.code]))(
		"quotes %s as the Template has it",
		(path, code) => {
			expect(code.trim()).not.toBe("");
			const source = readFileSync(new URL(barAsFoo(path ?? ""), app), "utf8");
			expect(indentsDrop(source)).toContain(indentsDrop(barAsFoo(code)).trim());
		},
	);
});
