import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	type ArchitectureFile,
	architectureRules,
} from "../apps/app/architecture-test-rules.ts";

// The app's architecture test runs A23 over src/; this runs it over everything else: the other
// folders, and the files at apps/app's top level.
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const roots = [
	"apps/app/clients",
	"apps/app/scripts",
	"apps/app/test",
	"packages",
	"scripts",
	"test",
];

const appTopLevel = readdirSync(path.join(repoRoot, "apps/app"))
	.filter((name) => /\.tsx?$/.test(name))
	.map((name) => `apps/app/${name}`);

const sourcesRead = (): ArchitectureFile[] => [
	...appTopLevel.map((name) => ({
		imports: [],
		path: name,
		source: readFileSync(path.join(repoRoot, name), "utf8"),
	})),
	...roots.flatMap((root) =>
		readdirSync(path.join(repoRoot, root), { recursive: true })
			.map((name) => `${root}/${String(name).split(path.sep).join("/")}`)
			.filter(
				(name) =>
					/\.tsx?$/.test(name) &&
					!name.endsWith(".d.ts") &&
					!/(^|\/)(node_modules|dist)\//.test(name),
			)
			.map((name) => ({
				imports: [],
				path: name,
				source: readFileSync(path.join(repoRoot, name), "utf8"),
			})),
	),
];

describe("naming", () => {
	it("names every export outside apps/app/src generic to specific (A23)", () => {
		const files = sourcesRead();
		expect(files.length).toBeGreaterThan(100);
		expect(architectureRules.A23?.(files)).toEqual([]);
	});
});
