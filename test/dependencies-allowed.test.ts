import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Every runtime dependency of a Package is an established choice someone gave a reason for, so a
// new library (a retry helper, a Result type, a second schema library) shows up in review as one
// line. The Template's own list and test are apps/app/dependencies-allowed.*.
type Manifest = Partial<
	Record<
		"dependencies" | "optionalDependencies" | "peerDependencies",
		Record<string, string>
	>
> & { name: string };

const jsonRead = <T>(path: string): T =>
	JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8")) as T;

const allowed = jsonRead<Record<string, unknown>>("dependencies-allowed.json");
const manifests = readdirSync(new URL("../packages/", import.meta.url)).map(
	(dir) => jsonRead<Manifest>(`packages/${dir}/package.json`),
);
const runtimeOf = (manifest: Manifest): string[] =>
	Object.keys({
		...manifest.dependencies,
		...manifest.optionalDependencies,
		...manifest.peerDependencies,
	}).filter((name) => !name.startsWith("@n8io/baseline-"));

describe("dependencies-allowed.json", () => {
	it("lists every runtime dependency of every Package", () => {
		const unlisted = manifests.flatMap((manifest) =>
			runtimeOf(manifest)
				.filter((name) => !Object.hasOwn(allowed, name))
				.map(
					(name) =>
						`${manifest.name} depends on ${name}, which is not in dependencies-allowed.json. Add it with a one-line reason, and only for an established, industry-standard library that no dependency here already covers.`,
				),
		);
		expect(unlisted).toEqual([]);
	});

	it("gives each entry a reason and lists only dependencies a Package has", () => {
		const used = new Set(manifests.flatMap(runtimeOf));
		const wrong = Object.entries(allowed).flatMap(([name, reason]) => [
			...(typeof reason === "string" && reason.trim() !== ""
				? []
				: [`${name}: give it a one-line reason`]),
			...(used.has(name)
				? []
				: [
						`${name} is no Package's runtime dependency: remove it from the list`,
					]),
		]);
		expect(wrong).toEqual([]);
	});
});
