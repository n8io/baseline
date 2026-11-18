import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import.meta.glob(["./dependencies-allowed.json", "./package.json"], {
	query: "?raw",
});

// Every runtime dependency is an established choice someone gave a reason for, so a new library
// (a retry helper, a Result type, a second schema library) shows up in review as one line.
// `@n8io/baseline-*` packages are exempt: they are the patterns this list protects.
type Manifest = Partial<
	Record<
		"dependencies" | "optionalDependencies" | "peerDependencies",
		Record<string, string>
	>
>;

const jsonRead = <T>(name: string): T =>
	JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), "utf8")) as T;

const manifest = jsonRead<Manifest>("package.json");
const allowed = jsonRead<Record<string, unknown>>("dependencies-allowed.json");
const runtime = new Set(
	Object.keys({
		...manifest.dependencies,
		...manifest.optionalDependencies,
		...manifest.peerDependencies,
	}).filter((name) => !name.startsWith("@n8io/baseline-")),
);

describe("dependencies-allowed.json", () => {
	it("lists every runtime dependency", () => {
		const unlisted = [...runtime].filter(
			(name) => !Object.hasOwn(allowed, name),
		);
		expect(
			unlisted.map(
				(name) =>
					`${name} is not in dependencies-allowed.json. Add it with a one-line reason, and only for an established, industry-standard library that no dependency here already covers.`,
			),
		).toEqual([]);
	});

	it("gives each entry a reason and lists only runtime dependencies", () => {
		const wrong = Object.entries(allowed).flatMap(([name, reason]) => [
			...(typeof reason === "string" && reason.trim() !== ""
				? []
				: [`${name}: give it a one-line reason`]),
			...(runtime.has(name)
				? []
				: [`${name} is no runtime dependency: remove it from the list`]),
		]);
		expect(wrong).toEqual([]);
	});
});
