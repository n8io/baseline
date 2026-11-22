import { describe, expect, it } from "vitest";
import {
	renameFilesPlan,
	renameStepsApply,
	renameStepsBetween,
	renameStepsParse,
} from "./template-renames.ts";

const steps = [
	{ release: "1.0.0", identifiers: { oldA: "newA" } },
	{
		release: "2.0.0",
		identifiers: { fooUpdateCan: "fooCanUpdate" },
		modules: { "./foo-specification.ts": "./foo-model.ts" },
		files: { "src/foo-specification.ts": "src/foo-model.ts" },
	},
	{ release: "3.0.0", identifiers: { later: "sooner" } },
];

describe("renameStepsBetween", () => {
	it("takes the steps after the Project's release, up to and including the target", () => {
		expect(
			renameStepsBetween({ steps, from: "1.0.0", to: "2.0.0" }).map(
				(s) => s.release,
			),
		).toEqual(["2.0.0"]);
		expect(
			renameStepsBetween({ steps, from: "1.9.0", to: "10.0.0" }).map(
				(s) => s.release,
			),
		).toEqual(["2.0.0", "3.0.0"]);
	});
});

describe("renameStepsParse", () => {
	it("reads a list and shrugs at anything else", () => {
		expect(renameStepsParse(JSON.stringify(steps))).toHaveLength(3);
		expect(renameStepsParse("")).toEqual([]);
		expect(renameStepsParse("{}")).toEqual([]);
	});
});

describe("renameStepsApply", () => {
	it("renames whole words and import paths in source files, and only those that change", () => {
		const changed = renameStepsApply({
			steps: [steps[1] ?? { release: "2.0.0" }],
			files: [
				{
					path: "src/a.ts",
					text: 'import { fooUpdateCan } from "./foo-specification.ts";\nfooUpdateCan(x) && fooUpdateCanNot;\n',
				},
				{ path: "src/b.ts", text: "const y = 1;\n" },
				{ path: "README.md", text: "fooUpdateCan\n" },
			],
		});
		expect(changed).toEqual([
			{
				path: "src/a.ts",
				text: 'import { fooCanUpdate } from "./foo-model.ts";\nfooCanUpdate(x) && fooUpdateCanNot;\n',
			},
		]);
	});
});

describe("renameStepsApply chains", () => {
	it("follows a name renamed in two releases", () => {
		const chain = [
			{ release: "2.0.0", identifiers: { a: "b" } },
			{ release: "3.0.0-beta.1", identifiers: { b: "c" } },
		];
		expect(
			renameStepsApply({
				steps: chain,
				files: [{ path: "src/x.ts", text: "a();\n" }],
			}),
		).toEqual([{ path: "src/x.ts", text: "c();\n" }]);
		expect(
			renameStepsBetween({ steps: chain, from: "2.0.0", to: "3.0.0" }),
		).toHaveLength(1);
	});
});

describe("renameFilesPlan", () => {
	it("moves a file the Project has to a path it does not", () => {
		const has = (path: string) => path === "src/foo-specification.ts";
		expect(renameFilesPlan({ has, steps })).toEqual([
			{ from: "src/foo-specification.ts", to: "src/foo-model.ts" },
		]);
		expect(renameFilesPlan({ has: () => true, steps })).toEqual([]);
	});
});
