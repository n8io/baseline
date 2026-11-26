import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { biomeConfigCreate } from "../scripts/biome-generate.ts";

const root = resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");

describe("apps/app/biome.json", () => {
	it("is what scripts/biome-config/ generates (run pnpm biome-generate)", () => {
		expect(JSON.parse(read("apps/app/biome.json"))).toEqual(
			biomeConfigCreate({
				patterns: read("scripts/biome-config/import-patterns.json"),
				source: read("scripts/biome-config/biome.source.json"),
			}),
		);
	});

	it("states each import pattern once, in import-patterns.json", () => {
		expect(read("scripts/biome-config/biome.source.json")).not.toContain(
			"@n8io/baseline-*/testing",
		);
	});
});
