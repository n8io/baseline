// glossary-check's map: CONTEXT-MAP.md's contexts and relationships, and what is wrong with them.
const contextThroughs = ["ACL", "Domain events"];

export type ContextMap = {
	contexts: { context: string; glossary: string }[];
	// Every CONTEXT.md the map links, contexts' and shared ones alike, relative to the map.
	glossaries: string[];
	relationships: { downstream: string; through: string[]; upstream: string }[];
};

// The cells of each row of the table under `## <heading>`, its header and divider left out.
const tableRowsRead = (text: string, heading: string): string[][] => {
	const lines = text.split("\n");
	const start = lines.indexOf(`## ${heading}`);
	if (start === -1) return [];
	const rows: string[][] = [];
	for (const line of lines.slice(start + 1)) {
		if (line.startsWith("## ")) break;
		if (!line.startsWith("|")) {
			if (rows.length > 0) break;
			continue;
		}
		rows.push(
			line
				.slice(1, line.lastIndexOf("|"))
				.split("|")
				.map((cell) => cell.trim()),
		);
	}
	return rows.slice(2);
};

const cellText = (cell = ""): string =>
	(/\]\(([^)]+)\)/.exec(cell)?.[1] ?? cell).replaceAll("`", "").trim();

// CONTEXT-MAP.md: a `## Contexts` table (Context | Language) and a `## Relationships`
// table (Downstream | Upstream | Through). docs/agents/context-create.md gives the format.
export const contextMapRead = (map: string): ContextMap => ({
	contexts: tableRowsRead(map, "Contexts").map(([context, glossary]) => ({
		context: cellText(context),
		glossary: cellText(glossary),
	})),
	glossaries: [
		...new Set(
			[...map.matchAll(/\]\(([^)]*CONTEXT\.md)\)/g)].map((m) => m[1] ?? ""),
		),
	],
	relationships: tableRowsRead(map, "Relationships").map(
		([downstream, upstream, through]) => ({
			downstream: cellText(downstream),
			through: cellText(through)
				.split(",")
				.map((t) => t.trim())
				.filter((t) => t !== ""),
			upstream: cellText(upstream),
		}),
	),
});

// What is wrong with an app's glossaries: CONTEXT.md holds only the shared terms, CONTEXT-MAP.md
// has one row per folder in src/contexts/ with its CONTEXT.md, and each relationship joins two listed contexts through an ACL,
// Domain events or both. `glossaryRead` returns undefined for a missing file.
export const contextMapViolations = ({
	appGlossary,
	contexts,
	glossaryRead,
	map,
}: {
	appGlossary: string;
	contexts: string[];
	glossaryRead: (path: string) => string | undefined;
	map: string;
}): string[] => {
	const problems: string[] = [];
	if (/^## Language\s*$/m.test(appGlossary)) {
		problems.push(
			"CONTEXT.md: move each term under ## Language into its context's src/contexts/<context>/CONTEXT.md, then delete the heading",
		);
	}
	const parsed = contextMapRead(map);
	if (!parsed.glossaries.includes("CONTEXT.md")) {
		problems.push("CONTEXT-MAP.md: link CONTEXT.md, the architecture terms");
	}
	const listed = parsed.contexts.map((c) => c.context);
	for (const context of contexts) {
		if (!listed.includes(context)) {
			problems.push(
				`CONTEXT-MAP.md: add a row for ${context} under ## Contexts`,
			);
		}
	}
	for (const { context, glossary } of parsed.contexts) {
		const path = `src/contexts/${context}/CONTEXT.md`;
		if (glossary !== path) {
			problems.push(
				`CONTEXT-MAP.md: link ${context}'s language as ${path}, not "${glossary}"`,
			);
		}
		if (!contexts.includes(context)) {
			problems.push(
				`CONTEXT-MAP.md: there is no src/contexts/${context}/; remove its row or run pnpm context-create ${context}`,
			);
			continue;
		}
		if (glossaryRead(path) === undefined) {
			problems.push(`${path}: add ${context}'s language`);
		}
	}
	for (const { downstream, through, upstream } of parsed.relationships) {
		const name = `CONTEXT-MAP.md: ${downstream} downstream of ${upstream}`;
		for (const end of [downstream, upstream]) {
			if (!listed.includes(end)) {
				problems.push(`${name}: ${end} is not under ## Contexts`);
			}
		}
		if (downstream === upstream) {
			problems.push(`${name}: a context does not relate to itself`);
		}
		if (
			through.length === 0 ||
			through.some((t) => !contextThroughs.includes(t))
		) {
			problems.push(`${name}: Through is ACL, Domain events or both`);
		}
	}
	return problems;
};
