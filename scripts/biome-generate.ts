// Writes apps/app/biome.json from scripts/biome-config/. Biome replaces (never merges) a rule's
// options across overrides, so every override repeats the import patterns it needs; the source
// config names each pattern once, as "$<name>", and import-patterns.json holds it. Run
// `pnpm biome-generate` after editing either; test/biome-generate.test.ts fails when
// apps/app/biome.json drifts from them. Projects get only the generated file, and a render edits it.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Pattern = Readonly<{ group: ReadonlyArray<string>; message: string }>;

const root = resolve(import.meta.dirname, "..");

const patternsResolve = (
	node: unknown,
	patterns: Readonly<Record<string, Pattern>>,
): unknown => {
	if (Array.isArray(node)) {
		return node.map((item) =>
			typeof item === "string" && item.startsWith("$")
				? patternResolve(item.slice(1), patterns)
				: patternsResolve(item, patterns),
		);
	}

	if (node !== null && typeof node === "object") {
		return Object.fromEntries(
			Object.entries(node).map(([key, value]) => [
				key,
				patternsResolve(value, patterns),
			]),
		);
	}

	return node;
};

const patternResolve = (
	name: string,
	patterns: Readonly<Record<string, Pattern>>,
): Pattern => {
	const pattern = patterns[name];

	if (!pattern) {
		throw new Error(
			`scripts/biome-config/import-patterns.json has no pattern "${name}"`,
		);
	}

	return pattern;
};

export const biomeConfigCreate = (input: {
	patterns: string;
	source: string;
}): unknown =>
	patternsResolve(
		JSON.parse(input.source),
		JSON.parse(input.patterns) as Record<string, Pattern>,
	);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const fileRead = (name: string): string =>
		readFileSync(join(root, name), "utf8");

	writeFileSync(
		join(root, "apps/app/biome.json"),
		`${JSON.stringify(
			biomeConfigCreate({
				patterns: fileRead("scripts/biome-config/import-patterns.json"),
				source: fileRead("scripts/biome-config/biome.source.json"),
			}),
			null,
			"\t",
		)}\n`,
	);
}
