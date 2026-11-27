import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { releaseRender, renderModulesFollow } from "./template-upgrade-keep.ts";

const file = (path: string, text: string) => ({ path, text });

// The render files as the 18.x layout ships them: the entry point plus the modules it imports.
const layout18 = () =>
	readdirSync(new URL(".", import.meta.url))
		.filter((name) => /^template-render(-[a-z]+)?\.ts$/.test(name))
		.map((name) =>
			file(
				`scripts/${name}`,
				readFileSync(new URL(name, import.meta.url), "utf8"),
			),
		);

describe("renderModulesFollow", () => {
	it("copies template-render-blocks.ts, which the 18.x entry point imports", () => {
		const paths = renderModulesFollow(layout18()).map((f) => f.path);

		expect(paths).toContain("scripts/template-render.ts");
		expect(paths).toContain("scripts/template-render-blocks.ts");
	});

	it("follows imports transitively, whatever the module names", () => {
		const paths = renderModulesFollow([
			file("scripts/template-render.ts", 'export * from "./a-b.ts";\n'),
			file("scripts/a-b.ts", 'import { x } from "./c_d.ts";\n'),
			file("scripts/c_d.ts", 'export const x = "";\n'),
			file("scripts/unused.ts", 'export const y = "";\n'),
		]).map((f) => f.path);

		expect(paths).toEqual([
			"scripts/template-render.ts",
			"scripts/a-b.ts",
			"scripts/c_d.ts",
		]);
	});

	it("names a module the entry point imports but the release lacks", () => {
		expect(() =>
			renderModulesFollow([
				file("scripts/template-render.ts", 'export * from "./gone.ts";\n'),
			]),
		).toThrow(
			/scripts\/gone\.ts is imported by the render but not in the release/,
		);
	});

	it("renders the 18.x layout end to end", async () => {
		const rendered = await releaseRender(layout18(), {
			description: "d",
			name: "app",
		});

		expect(Array.isArray(rendered)).toBe(true);
	});
});
