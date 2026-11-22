import { describe, expect, it } from "vitest";
import { contextMapKeep } from "./context-map-keep.ts";

const map = (rows: string[], header = "| Context | Subdomain | Language |") =>
	`# Context map\n\n## Contexts\n\n${header}\n| --- | --- | --- |\n${rows.join("\n")}\n\n## Relationships\n\n| Downstream | Upstream |\n| --- | --- |\n`;

describe("contextMapKeep", () => {
	it("keeps the Project's rows and cuts them to the Template's new columns", () => {
		const project = map([
			"| `league` | Core | `l.md` |",
			"| `tour`   | Supporting | `t.md` |",
		]);
		const from = [
			{ path: "CONTEXT-MAP.md", text: map(["| `foo` | Core | `f.md` |"]) },
		];
		const to = [
			{
				path: "CONTEXT-MAP.md",
				text: "# Context map\n\n## Contexts\n\n| Context | Language |\n| --- | --- |\n| `foo` | `f.md` |\n\n## Relationships\n\n| Downstream | Upstream |\n| --- | --- |\n",
			},
		];
		const kept = contextMapKeep({ from, to, project });
		expect(kept.from[0]?.text).toBe(project);
		expect(kept.to[0]?.text).toBe(
			"# Context map\n\n## Contexts\n\n| Context  | Language |\n| -------- | -------- |\n| `league` | `l.md`   |\n| `tour`   | `t.md`   |\n\n## Relationships\n\n| Downstream | Upstream |\n| --- | --- |\n",
		);
	});

	it("keeps a column the Project added and adds a row the Template brought", () => {
		const header = "| Context | Language | Owner |";
		const project = `## Contexts\n\n${header}\n| --- | --- | --- |\n| \`league\` | \`l.md\` | me |\n`;
		const from = [
			{
				path: "CONTEXT-MAP.md",
				text: "## Contexts\n\n| Context | Language |\n| --- | --- |\n| `foo` | `f.md` |\n",
			},
		];
		const to = [
			{
				path: "CONTEXT-MAP.md",
				text: "## Contexts\n\n| Context | Language |\n| --- | --- |\n| `foo` | `f.md` |\n| `bar` | `b.md` |\n",
			},
		];
		const text = contextMapKeep({ from, to, project }).to[0]?.text ?? "";
		expect(text).toContain("| `league` | `l.md`");
		expect(text).toContain("| me");
		expect(text).toContain("| `bar`");
	});

	it("leaves the renders alone when the Template has no such file", () => {
		const files = [{ path: "a.ts", text: "x" }];
		expect(contextMapKeep({ from: files, to: files, project: "p" })).toEqual({
			from: files,
			to: files,
		});
	});
});
