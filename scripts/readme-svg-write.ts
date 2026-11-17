// `pnpm readme-svg` writes each diagram in scripts/readme-svg/ (every .ts file at its top level
// but kit.ts and tests) to docs/readme/<file name>.svg. Helpers live in subfolders. test/readmes.test.ts checks the committed files equal this output.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const readmeSvgDirectory = "docs/readme";

const diagramDirectory = join(import.meta.dirname, "readme-svg");

// Every diagram, by name, rendered.
export const readmeSvgsRender = async (): Promise<Map<string, string>> => {
	const files = readdirSync(diagramDirectory)
		.filter(
			(file) =>
				file.endsWith(".ts") && file !== "kit.ts" && !file.endsWith(".test.ts"),
		)
		.sort();
	const entries = await Promise.all(
		files.map(async (file): Promise<[string, string]> => {
			const diagram = (await import(
				pathToFileURL(join(diagramDirectory, file)).href
			)) as { default?: unknown };
			if (typeof diagram.default !== "string") {
				throw new Error(
					`scripts/readme-svg/${file} must default-export its SVG as a string`,
				);
			}
			return [basename(file, ".ts"), diagram.default];
		}),
	);
	return new Map(entries);
};

export const readmeSvgsWrite = async (root: string): Promise<void> => {
	const directory = join(root, readmeSvgDirectory);
	mkdirSync(directory, { recursive: true });
	for (const [name, svg] of await readmeSvgsRender()) {
		writeFileSync(join(directory, `${name}.svg`), svg);
	}
};

if (import.meta.main) {
	await readmeSvgsWrite(resolve(import.meta.dirname, ".."));
}
