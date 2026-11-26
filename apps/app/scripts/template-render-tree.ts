// Reading and writing a tree of files, and rendering all of it.
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { readmeRender, templateFileRender } from "./template-render-files.ts";
import { processRun } from "./template-render-process.ts";
import type { TemplateAnswers, TemplateFile } from "./template-render-types.ts";

const skippedDirectories = new Set([
	".git",
	".react-router",
	"build",
	"node_modules",
]);

export const filesRead = (root: string, relative = ""): TemplateFile[] => {
	const files: TemplateFile[] = [];
	for (const entry of readdirSync(join(root, relative), {
		withFileTypes: true,
	})) {
		const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
		if (entry.isDirectory()) {
			if (!skippedDirectories.has(entry.name))
				files.push(...filesRead(root, path));
		} else if (entry.isFile()) {
			files.push({ path, text: readFileSync(join(root, path), "utf8") });
		}
	}
	return files.sort((a, b) => (a.path < b.path ? -1 : 1));
};

export const filesWrite = (root: string, files: TemplateFile[]): void => {
	for (const file of files) {
		const target = join(root, file.path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, file.text);
	}
};

// Renders every file; src/contexts/ stays as an empty folder the structure test reads.
export const templateFilesRender = (
	files: TemplateFile[],
	answers: TemplateAnswers,
): TemplateFile[] => {
	// README.md names the release package.json holds. It skips the foo-line removal: the leftovers
	// test in template-render.test.ts holds it free of foo.
	const manifest = files.find((file) => file.path === "package.json");
	const { version } = JSON.parse(manifest?.text ?? "{}") as {
		version?: string;
	};
	return [
		...files.flatMap((file) =>
			file.path === "README.md"
				? {
						...file,
						text: readmeRender({
							answers,
							release: version ?? "",
							text: file.text,
						}),
					}
				: (templateFileRender(file, answers) ?? []),
		),
		{ path: "src/contexts/.gitkeep", text: "" },
	];
};

// Line removal leaves formatting and unused imports for Biome, and src/env.d.ts for varlock.
// Runs both with the tools of `toolsDirectory` (a Project or apps/app with node_modules).
export const templateFinish = (
	directory: string,
	toolsDirectory: string,
): void => {
	const modules = join(directory, "node_modules");
	const linked = !existsSync(modules);
	if (linked) symlinkSync(join(toolsDirectory, "node_modules"), modules);
	try {
		const bin = (name: string) => join(modules, ".bin", name);
		processRun({
			command: bin("biome"),
			args: [
				"lint",
				"--write",
				"--unsafe",
				"--only=correctness/noUnusedImports",
				".",
			],
			options: { cwd: directory },
		});
		processRun({
			command: bin("biome"),
			args: ["check", "--write", "."],
			options: { cwd: directory },
		});
		try {
			processRun({
				command: bin("varlock"),
				args: ["codegen"],
				options: { cwd: directory },
			});
		} catch (error) {
			// A render across a secret-store swap names a varlock plugin these tools lack. The render
			// keeps its src/env.d.ts as it is; pnpm check regenerates it once the install has the plugin.
			const plugin = /Plugin "([^"]+)" unable to resolve/.exec(
				(error as Error).message,
			)?.[1];
			if (plugin === undefined) throw error;
			console.warn(
				`templateFinish: src/env.d.ts not regenerated, ${plugin} is not installed here`,
			);
		}
	} finally {
		if (linked) rmSync(modules);
	}
};
