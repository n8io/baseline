import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const workflows = [
	".github/workflows/integration.yml",
	".github/workflows/app-ci.yml",
];

// A service image is pinned by digest, so a tag moving under the workflow cannot change what CI runs.
const imageLineOf = /^\s*image:\s*(\S+)\s*$/;
const pinnedImageOf = /^[a-z0-9./-]+:[\w.-]+@sha256:[0-9a-f]{64}$/;

describe("CI service images", () => {
	it.each(workflows)("%s pins every service image by digest", (file) => {
		const images = readFileSync(join(root, file), "utf8")
			.split("\n")
			.map((line) => imageLineOf.exec(line)?.[1])
			.filter((image): image is string => image !== undefined);
		expect(images.length).toBeGreaterThan(0);
		expect(images.filter((image) => !pinnedImageOf.test(image))).toEqual([]);
	});
});
