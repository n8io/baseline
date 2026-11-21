import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	type ArchitectureFile,
	architectureRules,
} from "../apps/app/architecture-test-rules.ts";

// The Template runs A30 over all of apps/app (architecture.test.ts and structure.test.ts, so a
// Project runs it too); this runs it over the Packages and the root scripts.
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const roots = ["packages", "scripts"];

const sourcesRead = (): ArchitectureFile[] =>
	roots.flatMap((root) =>
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
	);

describe("inputs", () => {
	it("changes no input in a Package or a root script (A30)", () => {
		const files = sourcesRead();
		expect(files.length).toBeGreaterThan(100);
		expect(architectureRules["A30"]?.(files)).toEqual([]);
	});
});
