import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const srcDir = new URL("./", import.meta.url);
// `from "x"`, a bare `import "x"` and a dynamic `import("x")`.
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

		expect(imports.size).toBeGreaterThan(5);
		expect(reactImports).toStrictEqual([]);
	});

	it("reaches no test helper", () => {
		const files = [...reachableImports("./index.ts").keys()];

		expect(files.length).toBeGreaterThan(5);
		expect(files.filter((file) => /testing|-test-/.test(file))).toStrictEqual(
			[],
		);
	});
});

describe("the testing entry", () => {
	it("reaches the helpers and authn itself, but no test runner and no route or page code", () => {
		const imports = reachableImports("./testing.ts");

		expect([...imports.keys()].sort()).toStrictEqual([
			"./actor-schema.ts",
			"./actor.ts",
			"./authn-cookie.ts",
			"./authn-test-bearer.ts",
			"./authn-test-sign-in.ts",
			"./authn.ts",
			"./testing.ts",
		]);
		expect(
			[...new Set([...imports.values()].flat())].filter((specifier) =>
				specifier.startsWith("vitest"),
			),
		).toStrictEqual([]);
	});
});
