import {
	blocksOf,
	contextFilePaths,
	importsExplode,
	markerPattern,
} from "./model-create-foo.ts";
import { type ModelOption, wiringOptionOf } from "./model-create-options.ts";
import {
	contextsPairsFind,
	fooBlocksFind,
	lineIsFoo,
	linesRemove,
} from "./template-render.ts";

// Wiring

export const importEnd = (lines: string[]): number => {
	let end = -1;
	for (let i = 0; i < lines.length; i++) {
		if (!/^import /.test(lines[i] ?? "")) continue;
		end = i;
		while (!/;\s*$/.test(lines[end] ?? "") && end < lines.length) end++;
	}
	return end;
};

const namedImports = /^import\s+(type\s+)?\{([^}]*)\}\s*from\s*("[^"]+");/gm;

// The option a contexts-start/contexts-end pair serves, from its file and its template lines: a pair
// whose lines only that option uses stays empty until a Model brings the option.
export const pairOptionOf = ({
	content,
	path,
}: {
	content: string;
	path: string;
}): ModelOption | undefined => {
	if (path.startsWith("src/ui/")) return "pages";
	// The Server's argument to uiLoadContextCreate.
	if (path === "src/server.ts" && content.trim() === "contexts,") {
		return "pages";
	}
	return undefined;
};

// The project's pairs beside the template's, foo's lines left out of the template's.
const pairsMatch = ({
	path,
	project,
	template,
}: {
	path: string;
	project: string;
	template: string;
}) => {
	const source = linesRemove(template, fooBlocksFind(template, path)).split(
		"\n",
	);
	const pairs = contextsPairsFind(project, path);
	const sourcePairs = contextsPairsFind(source.join("\n"), path);
	if (pairs.length !== sourcePairs.length) {
		throw new Error(
			`${path}: has ${pairs.length} contexts-start/contexts-end pairs, the template ${sourcePairs.length}`,
		);
	}
	return pairs.map(([start, end], k) => {
		const [from, to] = sourcePairs[k] ?? [0, 0];
		const lines = source.slice(from + 1, to);
		return {
			empty: end === start + 1,
			lines,
			option: pairOptionOf({ path, content: lines.join("\n") }),
			start,
		};
	});
};

// Which pairs a command fills: context-create the ones no option needs, model-create the ones
// its options need.
export type PairWanted = (option: ModelOption | undefined) => boolean;

// Whether this file has an empty pair the command fills.
export const fileHasEmptyFillablePair = ({
	pairWanted,
	path,
	project,
	template,
}: {
	pairWanted: PairWanted;
	path: string;
	project: string;
	template: string;
}): boolean =>
	pairsMatch({ path, project, template }).some(
		(pair) => pair.empty && pairWanted(pair.option),
	);

// Fills each empty contexts-start/contexts-end pair the command wants with the template's lines,
// foo's left out, and imports the template names the render's Biome pass dropped as unused.
export const contextsPairsFill = ({
	pairWanted,
	path,
	project,
	template,
}: {
	pairWanted: PairWanted;
	path: string;
	project: string;
	template: string;
}): string => {
	const lines = project.split("\n");
	const pairs = pairsMatch({ path, project, template });
	for (const pair of [...pairs].reverse()) {
		if (pair.empty && pairWanted(pair.option)) {
			lines.splice(pair.start + 1, 0, ...pair.lines);
		}
	}
	return importsMissingAdd({ project: lines.join("\n"), template });
};

// Imports every name the template's file imports and the project's does not, foo's aside, or
// only those `used` names: the unused-imports pass then drops the ones no line uses.
const importsMissingAdd = ({
	project,
	template,
	used,
}: {
	project: string;
	template: string;
	used?: string;
}): string => {
	const lines = project.split("\n");
	const imported = new Set(
		[...project.matchAll(namedImports)].flatMap((m) =>
			(m[2] ?? "").split(",").map((name) => name.trim().split(/\s+/).at(-1)),
		),
	);
	const missing = [...template.matchAll(namedImports)]
		.filter((m) => !lineIsFoo(m[0]))
		.flatMap(([, type = "", names = "", from]) =>
			names
				.split(",")
				.map((name) => name.trim())
				.filter((name) => {
					const local = name.split(/\s+/).at(-1) ?? "";
					return (
						local !== "" &&
						!imported.has(local) &&
						(used === undefined || new RegExp(`\\b${local}\\b`).test(used))
					);
				})
				.map((name) => `import ${type}{ ${name} } from ${from};`),
		);
	// A file whose imports all went (src/contexts.ts) gets them back above a blank line.
	const noImports = importEnd(lines) === -1 && missing.length > 0;
	lines.splice(importEnd(lines) + 1, 0, ...missing, ...(noImports ? [""] : []));
	return lines.join("\n");
};

// Text as Biome may reflow it: no whitespace, no trailing comma before a closing bracket.
const spaceless = (text: string): string =>
	text.replaceAll(/\s+/g, "").replaceAll(/,(?=[)\]}>])/g, "");
// Whether the project already holds the block whole: `orderUseCases,` is not in
// `suborderUseCases,`, and a trailing comma the block ends with may be gone before a bracket.
const blockPresentIs = ({
	block,
	project,
}: {
	block: string;
	project: string;
}): boolean => {
	const needle = spaceless(block).replace(/,$/, "");
	const haystack = spaceless(project);
	for (let at = haystack.indexOf(needle); at !== -1; ) {
		const before = haystack[at - 1] ?? "";
		const after = haystack[at + needle.length] ?? "";
		const word = /[\w$]/;
		if (
			!(word.test(before) && word.test(needle[0] ?? "")) &&
			!(word.test(after) && word.test(needle.at(-1) ?? ""))
		) {
			return true;
		}
		at = haystack.indexOf(needle, at + 1);
	}
	return false;
};

// Adds the renamed copy of each block `blockIs` picks in the template's version of a file to the
// project's version: above the marker below it, or after the imports for an import. In a shared
// file the marker must come right after the block (other foo lines aside); in a context file it is
// the next marker down. A block the project already has is not added again, and neither is a line
// at a marker of an option left out (its import stays for the unused-imports pass to drop).
export const wiringInsert = ({
	blockIs,
	optionsLeftOut,
	path,
	project,
	rename,
	template,
}: {
	blockIs: (line: string) => boolean;
	optionsLeftOut?: ModelOption[] | null;
	path: string;
	project: string;
	rename: (text: string) => string;
	template: string;
}): string => {
	const lines = project.split("\n");
	const exploded = importsExplode(template);
	const templateLines = exploded.split("\n");
	const blocks = blocksOf({ lineIs: blockIs, path, text: exploded });
	const skipped = [...blocks, ...fooBlocksFind(exploded, path)];
	const inSkipped = (k: number) => skipped.some(([s, e]) => k >= s && k <= e);
	const context = contextFilePaths.has(path);
	const imports: string[] = [];
	const inserted: string[] = [];
	for (const [start, end] of blocks) {
		const text = rename(templateLines.slice(start, end + 1).join("\n"));
		if (blockPresentIs({ block: text, project })) continue;
		inserted.push(text);
		if (/^import /.test(templateLines[start] ?? "")) {
			imports.push(text);
			continue;
		}
		let anchor = end + 1;
		while (
			anchor < templateLines.length &&
			(context
				? !markerPattern.test(templateLines[anchor] ?? "")
				: inSkipped(anchor))
		) {
			anchor++;
		}
		const marker = templateLines[anchor] ?? "";
		if (!markerPattern.test(marker)) {
			throw new Error(
				`${path}: the template's line ${start + 1} names foo but has no wiring marker below it`,
			);
		}
		const option = wiringOptionOf({ path, marker });
		if (option !== undefined && optionsLeftOut?.includes(option)) continue;
		const at = lines.findIndex((line) => line.trim() === marker.trim());
		if (at === -1) {
			throw new Error(
				`${path}: missing marker "${marker.trim()}"; put it back where the template has it`,
			);
		}
		lines.splice(at, 0, ...text.split("\n"));
	}
	if (imports.length > 0) {
		lines.splice(importEnd(lines) + 1, 0, ...imports.join("\n").split("\n"));
	}
	return importsMissingAdd({
		project: lines.join("\n"),
		template,
		used: inserted.join("\n"),
	});
};
