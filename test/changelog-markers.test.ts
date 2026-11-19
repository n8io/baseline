import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

// A marker alone on a line, the shape context-create, aggregate-create, the render and piece-remove act on.
const markerLine =
	/^\s*(\/\/|#) (wiring|aggregate-create-start|aggregate-create-end|piece-start|piece-end):/;

// `changeset version` copies each changeset into apps/app/CHANGELOG.md, which sits in the
// Template beside the files the scripts scan for markers.
const notes = [
	...readdirSync(join(root, ".changeset"))
		.filter((name) => name.endsWith(".md"))
		.map((name) => `.changeset/${name}`),
	"apps/app/CHANGELOG.md",
].filter((path) => existsSync(join(root, path)));

describe("release notes", () => {
	it.each(notes)("%s names markers only inline", (path) => {
		const lines = readFileSync(join(root, path), "utf8")
			.split("\n")
			.map((line, index) => `${index + 1}: ${line}`)
			.filter((line) => markerLine.test(line.replace(/^\d+: /, "")));
		expect(lines).toEqual([]);
	});
});
