import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	barRemove,
	contextFilePaths,
	contextModelPathRename,
	contextModelRename,
	lineIsModel,
	markerPattern,
} from "./model-create-foo.ts";
import { contextReadsFind } from "./model-create-names.ts";
import {
	copiedPaths,
	homePaths,
	type ModelOption,
	modelOptions,
	optionsApply,
	templateWithoutPieces,
} from "./model-create-options.ts";
import { readsApply } from "./model-create-reads.ts";
import {
	contextsPairsFill,
	fileHasEmptyFillablePair,
	type PairWanted,
	wiringInsert,
} from "./model-create-wiring.ts";
import { piecesRemovedFind } from "./pieces.ts";
import {
	contextsPairsFind,
	fooPathRename,
	lineIsFoo,
	type NameForms,
	type TemplateFile,
} from "./template-render.ts";

// Building the Model

// The files a new Model adds or changes in a context made with context-create, from the
// template's files and the project's. `options` null copies every option (no --bare).
// drizzle-kit refuses two exported schemas of one name, so only a context's first table exports
// its pgSchema; a later Model's table keeps its own copy unexported, as Bar's does.
const schemaExportDrop = ({
	appDirectory,
	file,
}: {
	appDirectory: string;
	file: TemplateFile;
}): TemplateFile => {
	const folder =
		/^(src\/contexts\/[^/]+\/adapters\/outbound)\/[^/]+-table\.ts$/.exec(
			file.path,
		)?.[1];
	const exported = /^export (const \w+ = pgSchema\()/m;
	if (folder === undefined || !existsSync(join(appDirectory, folder)))
		return file;
	const tables = readdirSync(join(appDirectory, folder)).filter((name) =>
		name.endsWith("-table.ts"),
	);
	return tables.some((name) =>
		exported.test(readFileSync(join(appDirectory, folder, name), "utf8")),
	)
		? { ...file, text: file.text.replace(exported, "$1") }
		: file;
};

export const modelFilesCreate = ({
	model,
	appDirectory,
	context,
	options = null,
	templateFull,
}: {
	model: NameForms;
	appDirectory: string;
	context: string;
	options?: ModelOption[] | null;
	templateFull: TemplateFile[];
}): TemplateFile[] => {
	const optionsLeftOut =
		options === null
			? []
			: modelOptions.filter((option) => !options.includes(option));
	const contextNames = { kebab: context, plural: `${context}s` };
	const template = barRemove(
		templateWithoutPieces(templateFull, piecesRemovedFind(appDirectory)),
	);
	// The first Model with pages fills the / route's pair in src/ui/routes.ts and brings
	// home.tsx back with it.
	const routes = join(appDirectory, "src/ui/routes.ts");
	const homeAdded =
		!optionsLeftOut.includes("pages") &&
		existsSync(routes) &&
		contextsPairsFind(readFileSync(routes, "utf8"), "src/ui/routes.ts").some(
			([start, end]) => end === start + 1,
		);
	// foo's CONTEXT.md is the context's own language, which context-create writes.
	const copied = (path: string) =>
		!contextFilePaths.has(path) &&
		!path.endsWith("/CONTEXT.md") &&
		(copiedPaths.some((p) => p.test(path)) ||
			(homeAdded && homePaths.has(path)));
	const foo = template.filter((f) => copied(f.path));
	// A context that reads others passes its upstream to the ports calls in Foo's tests.
	const read = readsApply({
		files: foo,
		reads: contextReadsFind({ appDirectory, context }),
	}).filter((f) => foo.some((g) => g.path === f.path));
	const own = optionsApply({ files: read, optionsLeftOut });
	const rename = (path: string) => (text: string) =>
		contextModelRename({ model, context: contextNames, path, text });
	const pathOf = (path: string) =>
		contextModelPathRename({ model, context: contextNames, path });
	// Checked before anything is built, so a refusal writes nothing.
	for (const file of own) {
		if (existsSync(join(appDirectory, pathOf(file.path)))) {
			throw new Error(
				`${pathOf(file.path)} already exists; move it aside first`,
			);
		}
	}
	const files: TemplateFile[] = own.map((file) => ({
		path: pathOf(file.path),
		text: rename(file.path)(file.text),
	}));
	for (const file of template) {
		const contextFile = contextFilePaths.has(file.path);
		// Markdown is never wired: a changelog or doc that quotes a marker on its own line
		// (CHANGELOG.md, which no Project has) must not become a target.
		if (
			copied(file.path) ||
			(file.path.startsWith("src/contexts/") && !contextFile) ||
			/^(scripts|test)\//.test(file.path) ||
			file.path.endsWith(".md") ||
			!file.text.split("\n").some((line) => markerPattern.test(line))
		) {
			continue;
		}
		const path = contextFile
			? fooPathRename(file.path, contextNames)
			: file.path;
		const target = join(appDirectory, path);
		if (!existsSync(target)) {
			throw new Error(`${path} is missing; the template wires Models there`);
		}
		const [source = file] = contextFile
			? optionsApply({ files: [file], optionsLeftOut })
			: [file];
		const project = readFileSync(target, "utf8");
		const pairWanted: PairWanted = (option) =>
			option === undefined || !optionsLeftOut.includes(option);
		files.push({
			path,
			text: wiringInsert({
				// A UI line naming only the context, such as its Use cases' key, comes with the
				// context's first Model with pages.
				blockIs: (line) =>
					lineIsModel(line) ||
					(file.path.startsWith("src/ui/") && lineIsFoo(line)),
				optionsLeftOut,
				path: file.path,
				project: fileHasEmptyFillablePair({
					pairWanted,
					path,
					project,
					template: source.text,
				})
					? contextsPairsFill({
							pairWanted,
							path,
							project,
							template: source.text,
						})
					: project,
				rename: rename(file.path),
				template: source.text,
			}),
		});
	}
	return files.map((file) => schemaExportDrop({ appDirectory, file }));
};

// Formats what context-create or model-create wrote. An option or piece left out leaves imports
// nothing uses, so an unused-imports pass goes first.
