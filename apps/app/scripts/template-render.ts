// Shared by context-create, model-create, template-upgrade and app-create: fetches a baseline
// release and renders apps/app without the foo context. Native TS, no dependencies; shells out to
// git and pnpm. The code lives in template-render-*.ts modules, one per concern, and this file
// re-exports their names.
// Why a JS/TS-aware scanner renames foo instead of wiring markers alone: foo also appears in
// regex literals, JSX text and prose, where a plain replace or a marker would rename the wrong text
// or miss it. render-and-test renders and tests a Project on every PR, so it covers the scanner.

export {
	fooBlocksFind,
	linesBlocksFind,
	linesRemove,
} from "./template-render-blocks.ts";
export {
	contextsPairsEmpty,
	contextsPairsFind,
	hostPortsCreate,
	readmeRender,
	templateFileRender,
} from "./template-render-files.ts";
export {
	camelFromKebab,
	fooPathRename,
	fooRename,
	pascalFromKebab,
} from "./template-render-names.ts";
export {
	appIsMonorepo,
	clientManifestPin,
	lockfileRender,
	releaseLatest,
	templateAnswers,
	templateExport,
	templateExportOwn,
	templateFetch,
	templateFetchOwn,
	templateJsonRead,
	workspaceRender,
} from "./template-render-release.ts";
export { fileIsCode, lineIsFoo, modesRead } from "./template-render-scan.ts";
export {
	filesRead,
	filesWrite,
	templateFilesRender,
	templateFinish,
} from "./template-render-tree.ts";
export type {
	NameForms,
	TemplateAnswers,
	TemplateFile,
} from "./template-render-types.ts";
