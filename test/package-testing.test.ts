import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// docs/agents/packages.md "Test exports": what a Package ships never loads a test runner, and its main
// entry never loads a test helper. Test helpers reach callers only through src/testing.ts.
type Source = { path: string; source: string };

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

const runnerIs = (specifier: string): boolean =>
	/^(vitest|@vitest\/[^/]+|node:test)(\/|$)/.test(specifier);
const testingEntryIs = (p: string): boolean =>
	/^packages\/[^/]+\/src\/testing\.ts$/.test(p);
// Tests, contract tests, Vitest global setups and `<package>-test-*` helpers.
const testOnlyIs = (p: string): boolean =>
	/\.test\.tsx?$|\.contract\.ts$|-global-setup\.ts$|(^|\/)[^/]*-test-[^/]*(\/|$)/.test(
		p,
	);

// Statements that start a line, so an import shown in a comment is not one; plus `import()`.
const importsOf = ({ path: from, source }: Source) =>
	[
		...source.matchAll(
			/^\s*(?:import\s*|(?:import|export)\b[^;'"]*?\bfrom\s*)["']([^"']+)["']/gm,
		),
		...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']/g),
	].map(([, specifier = ""]) => ({
		specifier,
		target: specifier.startsWith(".")
			? path.posix.join(path.posix.dirname(from), specifier)
			: specifier,
	}));

const packageTestingCheck = (files: Source[]): string[] => {
	const byPath = new Map(files.map((f) => [f.path, f]));
	// Everything src/testing.ts loads ships with it.
	const shipped = new Set<string>();
	const shippedAdd = (p: string): void => {
		const file = byPath.get(p);
		if (!file || shipped.has(p)) return;
		shipped.add(p);
		for (const imp of importsOf(file)) shippedAdd(imp.target);
	};
	for (const f of files) if (testingEntryIs(f.path)) shippedAdd(f.path);

	return files.flatMap((f) => {
		const production = !testOnlyIs(f.path) && !testingEntryIs(f.path);
		if (!production && !shipped.has(f.path)) return [];
		return importsOf(f).flatMap((imp) => {
			const reason = runnerIs(imp.specifier)
				? "nothing a Package exports imports a test runner; take what the helper needs as an argument"
				: production &&
						(testOnlyIs(imp.target) ||
							testingEntryIs(imp.target) ||
							/^@n8io\/baseline-[^/]+\/testing$/.test(imp.specifier))
					? "production code never imports a test helper; export it from src/testing.ts and import it from tests"
					: undefined;
			return reason ? [`${f.path} imports ${imp.specifier}: ${reason}`] : [];
		});
	});
};

const sourcesRead = (): Source[] =>
	readdirSync(path.join(repoRoot, "packages"), { recursive: true })
		.map((name) => `packages/${String(name).split(path.sep).join("/")}`)
		.filter(
			(name) =>
				/^packages\/[^/]+\/src\/.*\.tsx?$/.test(name) &&
				!name.endsWith(".d.ts"),
		)
		.map((name) => ({
			path: name,
			source: readFileSync(path.join(repoRoot, name), "utf8"),
		}));

describe("package testing", () => {
	it("keeps test runners and test helpers out of what every Package ships", () => {
		const files = sourcesRead();
		expect(files.length).toBeGreaterThan(100);
		expect(packageTestingCheck(files)).toEqual([]);
	});

	it("fails on each kind of leak", () => {
		const source = (p: string, text: string): Source => ({
			path: `packages/bar/src/${p}`,
			source: text,
		});
		expect(
			packageTestingCheck([
				source("index.ts", 'export * from "./bar-test-read.ts";\n'),
				source(
					"bar.ts",
					'/**\n * import { barTestRead } from "@n8io/baseline-bar/testing";\n */\nimport {\n\tvi,\n} from "vitest";\n',
				),
				source("bar-hub.ts", 'import "./bar-hub.contract.ts";\n'),
				source("bar-open.ts", 'await import("./testing.ts");\n'),
				source("testing.ts", 'export * from "./bar-test-read.ts";\n'),
				source("bar-test-read.ts", 'import { expect } from "vitest";\n'),
				// Not shipped, so free to use the runner.
				source("bar-test-app.ts", 'import { vi } from "vitest";\n'),
				source("bar.contract.ts", 'import { it } from "vitest";\n'),
				source("bar.test.ts", 'import "./bar-test-app.ts";\n'),
			]),
		).toEqual([
			"packages/bar/src/index.ts imports ./bar-test-read.ts: production code never imports a test helper; export it from src/testing.ts and import it from tests",
			"packages/bar/src/bar.ts imports vitest: nothing a Package exports imports a test runner; take what the helper needs as an argument",
			"packages/bar/src/bar-hub.ts imports ./bar-hub.contract.ts: production code never imports a test helper; export it from src/testing.ts and import it from tests",
			"packages/bar/src/bar-open.ts imports ./testing.ts: production code never imports a test helper; export it from src/testing.ts and import it from tests",
			"packages/bar/src/bar-test-read.ts imports vitest: nothing a Package exports imports a test runner; take what the helper needs as an argument",
		]);
	});
});
