import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Every Package commits the MIT notice, and every package.json reads the same way, so npm shows
// every Package in one voice and a diff of one manifest never reorders it.
const keyOrder = [
	"name",
	"version",
	"description",
	"license",
	"type",
	"engines",
	"repository",
	"exports",
	"files",
	"sideEffects",
	"publishConfig",
	"scripts",
	"dependencies",
	"devDependencies",
	"peerDependencies",
	"peerDependenciesMeta",
];

// docs/agents/packages.md: Packages carry none of these.
const keysBanned = ["keywords", "homepage", "bugs"];

const textRead = (path: string): string =>
	readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const packageDirs = readdirSync(new URL("../packages/", import.meta.url));

describe("Package metadata", () => {
	it("ships a LICENSE equal to the root one in every Package", () => {
		const license = textRead("LICENSE");
		const wrong = packageDirs.filter(
			(dir) =>
				!existsSync(new URL(`../packages/${dir}/LICENSE`, import.meta.url)) ||
				textRead(`packages/${dir}/LICENSE`) !== license,
		);
		expect(
			wrong,
			"copy the root LICENSE into each listed Package: cp LICENSE packages/<dir>/LICENSE",
		).toEqual([]);
	});

	it("keeps every package.json's keys in one order", () => {
		const wrong = packageDirs.flatMap((dir) => {
			const keys = Object.keys(
				JSON.parse(textRead(`packages/${dir}/package.json`)) as object,
			);
			const banned = keys.filter((key) => keysBanned.includes(key));
			if (banned.length > 0)
				return [
					`${dir}: remove ${banned.join(", ")}: Packages carry no keywords, homepage or bugs (docs/agents/packages.md)`,
				];
			const unknown = keys.filter((key) => !keyOrder.includes(key));
			if (unknown.length > 0)
				return [
					`${dir}: add ${unknown.join(", ")} to keyOrder in test/package-metadata.test.ts`,
				];
			const expected = keyOrder.filter((key) => keys.includes(key));
			return keys.join() === expected.join()
				? []
				: [`${dir}: order the keys ${expected.join(", ")}`];
		});
		expect(wrong).toEqual([]);
	});

	// Root `pnpm test:unit` runs through turbo, which skips a Package without the script: a
	// Package missing it would pass with none of its tests run.
	it("has the build, check, prepack, test and test:unit scripts in every Package", () => {
		const scriptsRequired = ["build", "check", "prepack", "test", "test:unit"];
		const wrong = packageDirs.flatMap((dir) => {
			const { scripts = {} } = JSON.parse(
				textRead(`packages/${dir}/package.json`),
			) as { scripts?: Record<string, string> };
			const missing = scriptsRequired.filter((name) => !(name in scripts));
			return missing.length > 0 ? [`${dir}: add ${missing.join(", ")}`] : [];
		});
		expect(
			wrong,
			'test:unit runs the tests that need no Docker: "vitest run" where none do (docs/agents/packages.md)',
		).toEqual([]);
	});

	it("ends every description with a full stop", () => {
		const wrong = packageDirs.filter((dir) => {
			const { description } = JSON.parse(
				textRead(`packages/${dir}/package.json`),
			) as { description?: string };
			return !description?.endsWith(".");
		});
		expect(wrong, "end the description with a full stop").toEqual([]);
	});

	// The standard tree-shaking field: a bundler drops what a browser build never calls.
	it("marks the Packages with browser entries as free of side effects", () => {
		const wrong = ["authn", "feature-flags", "live", "sdk"].filter(
			(dir) =>
				(
					JSON.parse(textRead(`packages/${dir}/package.json`)) as {
						sideEffects?: boolean;
					}
				).sideEffects !== false,
		);
		expect(wrong, 'add "sideEffects": false to each listed Package').toEqual(
			[],
		);
	});
});
