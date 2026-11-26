import {
	fooPathRename,
	fooRename,
	lineIsFoo,
	linesBlocksFind,
	linesRemove,
	type NameForms,
	type TemplateFile,
} from "./template-render.ts";

export const kebabPattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
// Where renamed lines go; contexts-start and contexts-end only delimit.
export const markerPattern =
	/^\s*(\/\/|#) wiring: (?!contexts-(start|end)\s*$)[a-z-]+\s*$/;

// ---------------------------------------------------------------------------
// The Template's foo context: its context files, Foo's files, and Bar's

// The context's own files. context-create copies them without any Model's lines;
// model-create adds its Model's lines at their `wiring:` markers.
export const contextFilePaths = new Set(
	[
		"index.ts",
		"application/foo-use-cases.ts",
		"application/ports.ts",
		"domain/errors.ts",
		"domain/repositories.ts",
		"adapters/outbound/foo-ports.memory.ts",
		"adapters/outbound/foo-transaction.memory.ts",
		"adapters/outbound/foo-transaction.postgres.ts",
		"adapters/outbound/index-queue.test.ts",
		"adapters/outbound/index.ts",
	].map((path) => `src/contexts/foo/${path}`),
);

// Bar, foo's second Model, stays in the Template: neither command ever copies it.
const barPathIs = (path: string): boolean =>
	/^src\/contexts\/foo\/(.+\/)?bar[-.][^/]*$/.test(path) ||
	/^migrations\/[^/]*_foo_bar_[^/]*\//.test(path);
// A line naming Bar: its identifiers (barCreate, BarRepository, bars), its id prefix ("bar") and
// its files (./bar-routes.ts), not a word such as "bar:read" or a nav-bar.
export const lineIsBar = (line: string): boolean =>
	/\b(bar[A-Z]\w*|Bar[A-Za-z0-9]*|bars)\b|"bar"|\/bar[-.]/.test(line);

// A foo that names the context, not the Foo Model: its interface, ports, transaction, Use
// cases, ACLs and upstream, Schedules list and memory state, its Postgres schema, and the paths of its folder and its own files.
const contextFooPattern =
	/\b(foo|Foo)(?=(?:Context|ContextCreate|Ports|PortsCreate|PortsMemoryCreate|Upstream|TestUpstreamCreate|Schedules|Transaction|TransactionPorts|TransactionMemoryCreate|TransactionPostgresCreate|Clock|UseCases|UseCasesCreate|UseCasesContext|MemoryState|MemoryStateCreate|[A-Z][A-Za-z0-9]*(?:Acl(?:Create|Actor)?|Upstream))\b)|(?<=contexts\/)foo(?=\/)|(?<=pgSchema\(")foo(?=")|\bfoo(?=-(?:use-cases|ports\.memory|test-upstream|transaction\.(?:memory|postgres))\.ts\b|-[a-z0-9-]+-acl(?:\.test)?\.ts\b)/g;
const contextPlaceholder = (text: string): string =>
	text.replace(contextFooPattern, (foo) => (foo === "Foo" ? "Qqctx" : "qqctx"));

// A line that names the Foo Model, not only the context.
export const lineIsModel = (line: string): boolean =>
	lineIsFoo(contextPlaceholder(line));

// Renames foo for a Model in a context: the context's names where foo is the context, the
// Model's everywhere else.
export const contextModelRename = ({
	model,
	context,
	path,
	text,
}: {
	model: NameForms;
	context: NameForms;
	path: string;
	text: string;
}): string =>
	fooRename({
		names: context,
		path,
		text: fooRename({ names: model, path, text: contextPlaceholder(text) })
			.replaceAll("Qqctx", "Foo")
			.replaceAll("qqctx", "foo"),
	});

export const contextModelPathRename = ({
	model,
	context,
	path,
}: {
	model: NameForms;
	context: NameForms;
	path: string;
}): string =>
	fooPathRename(
		path.replace(/^src\/contexts\/foo\//, "src/contexts/qqctx/"),
		model,
	).replace(/^src\/contexts\/qqctx\//, `src/contexts/${context.kebab}/`);

// One import or re-export per name, so a line names one Model's or the context's only. Biome
// merges them back.
export const importsExplode = (text: string): string =>
	text.replace(
		/^(import|export)(\s+type)?\s*\{([^}]*)\}\s*from\s*("[^"]+");/gm,
		// biome-ignore lint/complexity/useMaxParams: String.replace passes each match this way.
		(whole, keyword: string, type = "", names: string, from: string) => {
			const list = names
				.split(",")
				.map((name) => name.trim())
				.filter((name) => name !== "");
			return list.length < 2
				? whole
				: list
						.map((name) => `${keyword}${type} { ${name} } from ${from};`)
						.join("\n");
		},
	);

const markerCommentIs = (line: string): boolean =>
	/^\s*\/\/ (piece-(start|end):|wiring:|model-create-(start|end):|biome-ignore)/.test(
		line,
	);

// In a context file a block takes the comment lines just above it, and the piece or option block
// that holds nothing else.
const blocksGrow = (
	text: string,
	blocks: [number, number][],
): [number, number][] => {
	const lines = text.split("\n");
	const grown = blocks.map(([from, to]): [number, number] => {
		let start = from;
		let end = to;
		for (;;) {
			const above = lines[start - 1] ?? "";
			const pair = /^\s*\/\/ (piece|model-create)-start: (\S+)\s*$/.exec(above);
			if (/^\s*\/\//.test(above) && !markerCommentIs(above)) start--;
			else if (
				pair !== null &&
				new RegExp(`^\\s*// ${pair[1]}-end: ${pair[2]}\\s*$`).test(
					lines[end + 1] ?? "",
				)
			) {
				start--;
				end++;
			} else break;
		}
		return [start, end];
	});
	const joined: [number, number][] = [];
	for (const [start, end] of grown.sort((a, b) => a[0] - b[0])) {
		const last = joined.at(-1);
		if (last !== undefined && start <= last[1] + 1) {
			last[1] = Math.max(last[1], end);
		} else joined.push([start, end]);
	}
	return joined;
};

// The blocks of `text` whose lines `lineIs` picks; grown as blocksGrow says in a context file.
export const blocksOf = ({
	lineIs,
	path,
	text,
}: {
	lineIs: (line: string) => boolean;
	path: string;
	text: string;
}): [number, number][] => {
	const blocks = linesBlocksFind({ lineIs, path, text });
	return contextFilePaths.has(path) ? blocksGrow(text, blocks) : blocks;
};

// A template file without Bar: its files go, and its lines leave the files Foo shares with it.
export const barRemove = (files: TemplateFile[]): TemplateFile[] =>
	files
		.filter((file) => !barPathIs(file.path))
		.map((file) => {
			// Bar lives in src/; scripts and tests elsewhere may say bar for something else.
			if (
				!file.path.startsWith("src/") ||
				!file.text.split("\n").some(lineIsBar)
			) {
				return file;
			}
			const text = importsExplode(file.text);
			return {
				path: file.path,
				text: linesRemove(
					text,
					blocksOf({ lineIs: lineIsBar, path: file.path, text }),
				),
			};
		});
