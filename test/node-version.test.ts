import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	enginesRead,
	manifestsList,
	nodeMajorRead,
	templateNodeVersion,
} from "../scripts/node-version-sync.ts";

const root = new URL("../", import.meta.url).pathname;

// .node-version is the one place the Node version lives; every engines.node derives from it.
describe(".node-version", () => {
	it("equals the Template's apps/app/.node-version", () => {
		expect(
			readFileSync(`${root}${templateNodeVersion}`, "utf8"),
			"run `pnpm node-version-sync` to copy .node-version to apps/app/.node-version",
		).toBe(readFileSync(`${root}.node-version`, "utf8"));
	});

	it("matches engines.node in every package.json", () => {
		const major = nodeMajorRead(root);
		const wrong = manifestsList(root).flatMap((file) => {
			const found = enginesRead(readFileSync(`${root}${file}`, "utf8"));
			return found === `>=${major}`
				? []
				: [`${file}: engines.node is ${found ?? "missing"}, want >=${major}`];
		});
		expect(
			wrong,
			"run `pnpm node-version-sync` to write engines.node from .node-version",
		).toEqual([]);
	});
});
