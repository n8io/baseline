// What a Project does by hand around context-create and model-create: it lists the context in
// CONTEXT-MAP.md first, then adds each Model's term to the context's own CONTEXT.md.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The map with a row for the context added at the end of its `## Contexts` table.
export const glossaryContextMapRowAdd = ({
	context,
	map,
}: {
	context: string;
	map: string;
}): string => {
	const lines = map.split("\n");
	const start = lines.indexOf("## Contexts");
	if (start === -1) throw new Error("CONTEXT-MAP.md has no ## Contexts");
	let last = start;
	for (let k = start + 1; k < lines.length; k++) {
		const line = lines[k] ?? "";
		if (line.startsWith("## ")) break;
		if (line.startsWith("|")) last = k;
	}
	const row = `| \`${context}\` | [src/contexts/${context}/CONTEXT.md](src/contexts/${context}/CONTEXT.md) |`;
	lines.splice(last + 1, 0, row);
	return lines.join("\n");
};

export const glossaryContextMapDefine = ({
	context,
	directory,
}: {
	context: string;
	directory: string;
}): void => {
	const path = join(directory, "CONTEXT-MAP.md");
	writeFileSync(
		path,
		glossaryContextMapRowAdd({
			context,
			map: readFileSync(path, "utf8"),
		}),
	);
};

// Appends a term to a context's CONTEXT.md, under the `## Language` context-create left last.
export const glossaryTermAdd = ({
	context,
	definition,
	directory,
	term,
}: {
	context: string;
	definition: string;
	directory: string;
	term: string;
}): void => {
	appendFileSync(
		join(directory, "src/contexts", context, "CONTEXT.md"),
		`\n**${term}**:\n${definition}\n`,
	);
};
