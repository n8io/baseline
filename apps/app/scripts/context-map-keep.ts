// CONTEXT-MAP.md is a table the Project extends with its own contexts, so a plain 3-way merge
// conflicts as soon as the Template changes the table's header or columns, and taking the Template's
// side drops the Project's rows. Both renders carry the Project's rows instead: the one the Project
// started from verbatim, the new one re-cut to the Template's new columns, so the merge brings the
// column change in and leaves every row the Project has.
import type { TemplateFile } from "./template-render.ts";

type Table = {
	cells: string[][];
	end: number;
	header: string[];
	start: number;
};

const cellsOf = (line: string): string[] =>
	line
		.trim()
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split("|")
		.map((cell) => cell.trim());

// The table under each `## ` heading, by heading.
const tablesFind = (lines: string[]): Map<string, Table> => {
	const tables = new Map<string, Table>();
	let heading = "";
	lines.forEach((line, at) => {
		if (line.startsWith("## ")) heading = line;
		if (!line.startsWith("|") || tables.has(heading)) return;
		const end = lines.findIndex((l, i) => i > at && !l.startsWith("|"));
		const stop = end === -1 ? lines.length : end;
		tables.set(heading, {
			cells: lines.slice(at + 2, stop).map(cellsOf),
			end: stop,
			header: cellsOf(line),
			start: at,
		});
	});
	return tables;
};

const tableRender = ({
	cells,
	header,
}: {
	cells: string[][];
	header: string[];
}): string[] => {
	const widths = header.map((name, at) =>
		Math.max(3, name.length, ...cells.map((row) => (row[at] ?? "").length)),
	);
	const line = (row: string[]) =>
		`| ${widths.map((width, at) => (row[at] ?? "").padEnd(width)).join(" | ")} |`;
	return [
		line(header),
		`| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`,
		...cells.map(line),
	];
};

const tableReplace = ({
	lines,
	table,
	with: next,
}: {
	lines: string[];
	table: Table;
	with: string[];
}): string[] => [
	...lines.slice(0, table.start),
	...next,
	...lines.slice(table.end),
];

export const contextMapKeep = ({
	from,
	project,
	to,
}: {
	from: TemplateFile[];
	project: string;
	to: TemplateFile[];
}): { from: TemplateFile[]; to: TemplateFile[] } => {
	const path = "CONTEXT-MAP.md";
	const fromText = from.find((f) => f.path === path)?.text;
	const toText = to.find((f) => f.path === path)?.text;
	if (fromText === undefined || toText === undefined) return { from, to };
	const own = project.split("\n");
	const ownTables = tablesFind(own);
	let fromLines = fromText.split("\n");
	let toLines = toText.split("\n");
	for (const [heading, mine] of ownTables) {
		const before = tablesFind(fromLines).get(heading);
		const after = tablesFind(toLines).get(heading);
		if (before === undefined || after === undefined) continue;
		const verbatim = own.slice(mine.start, mine.end);
		fromLines = tableReplace({
			lines: fromLines,
			table: before,
			with: verbatim,
		});
		const columns = [
			...after.header,
			...mine.header.filter((name) => !before.header.includes(name)),
		];
		const keys = new Set([
			...mine.cells.map((row) => row[0]),
			...before.cells.map((row) => row[0]),
		]);
		const cut = (header: string[]) => (row: string[]) =>
			columns.map((name) => row[header.indexOf(name)] ?? "");
		const rows = [
			...mine.cells.map(cut(mine.header)),
			...after.cells.filter((row) => !keys.has(row[0])).map(cut(after.header)),
		];
		const same =
			columns.length === mine.header.length &&
			columns.every((name, at) => name === mine.header[at]) &&
			rows.length === mine.cells.length;
		toLines = tableReplace({
			lines: toLines,
			table: after,
			with: same ? verbatim : tableRender({ cells: rows, header: columns }),
		});
	}
	const swap = (files: TemplateFile[], lines: string[]) =>
		files.map((f) => (f.path === path ? { ...f, text: lines.join("\n") } : f));
	return { from: swap(from, fromLines), to: swap(to, toLines) };
};
