import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The main entry must load in a service that installs neither react nor react-router, and the
// testing entry loads no package at all. Test runners and test helpers in what a Package ships are
// checked for every Package by test/package-testing.test.ts.
const srcDir = new URL("./", import.meta.url);
// `from "x"`, a bare `import "x"` and a dynamic `import("x")`.
// Copied from packages/authn/src/index.test.ts; keep the two in step.
const importPattern = /(?:\bfrom|\bimport)\s*\(?\s*"([^"]+)"/g;

// Every specifier imported by index.ts and the files it reaches, keyed by file.
const reachableImports = (entry: string): Map<string, string[]> => {
	const seen = new Map<string, string[]>();
	const pending = [entry];
	for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
		if (seen.has(file)) continue;
		const source = readFileSync(new URL(file, srcDir), "utf8");
		const specifiers = [...source.matchAll(importPattern)].map(
			([, specifier]) => specifier ?? "",
		);
		seen.set(file, specifiers);
		pending.push(
			...specifiers.filter((specifier) => specifier.startsWith("./")),
		);
	}
	return seen;
};

describe("the main entry", () => {
	it("reaches no file that imports react or react-router", () => {
		const imports = reachableImports("./index.ts");
		const reactImports = [...imports].flatMap(([file, specifiers]) =>
			specifiers
				.filter((specifier) => /^react(?:-router)?(?:\/|$)/.test(specifier))
				.map((specifier) => `${file} imports ${specifier}`),
		);

		expect(imports.size).toBeGreaterThan(3);
		expect(reactImports).toStrictEqual([]);
	});
});

describe("the testing entry", () => {
	it("imports no package, so no server and no test runner", () => {
		const imports = reachableImports("./testing.ts");
		const packageImports = [...imports].flatMap(([file, specifiers]) =>
			specifiers
				.filter((specifier) => !specifier.startsWith("./"))
				.map((specifier) => `${file} imports ${specifier}`),
		);

		expect(imports.size).toBe(2);
		expect(packageImports).toStrictEqual([]);
	});
});
