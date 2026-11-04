// pnpm glossary-check: warns on every `_Avoid_:` alias from CONTEXT.md in lines added against
// origin/main. Warnings only: the agent judges each hit, so it always exits 0.
import { readFileSync } from "node:fs";
import { run } from "./template-render.ts";

type GlossaryAlias = { alias: string; term: string };

type GlossaryHit = GlossaryAlias & { file: string; line: number };

// Every `_Avoid_:` alias with the `**Term**:` it belongs to, from both sections.
export const glossaryAliasesRead = (context: string): GlossaryAlias[] => {
	const aliases: GlossaryAlias[] = [];
	let term: string | undefined;
	for (const line of context.split("\n")) {
		const heading = /^\*\*(.+)\*\*:\s*$/.exec(line);
		if (heading?.[1] !== undefined) term = heading[1];
		const avoid = /^_Avoid_:\s*(.+)$/.exec(line);
		if (avoid?.[1] === undefined || term === undefined) continue;
		for (const alias of avoid[1].split(",")) {
			const trimmed = alias.trim();
			if (trimmed !== "") aliases.push({ alias: trimmed, term });
		}
	}
	return aliases;
};

// The added lines of a unified diff, with their file and line number in the new version.
export const diffAddedLines = (
	diff: string,
): { file: string; line: number; text: string }[] => {
	const added: { file: string; line: number; text: string }[] = [];
	let file: string | undefined;
	let line = 0;
	for (const row of diff.split("\n")) {
		if (row.startsWith("+++ ")) {
			file =
				row === "+++ /dev/null" ? undefined : row.replace(/^\+\+\+ b\//, "");
			continue;
		}
		const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row);
		if (hunk?.[1] !== undefined) {
			line = Number(hunk[1]);
			continue;
		}
		if (file === undefined) continue;
		if (row.startsWith("+")) {
			added.push({ file, line, text: row.slice(1) });
			line++;
		} else if (row.startsWith(" ")) {
			line++;
		}
	}
	return added;
};

export const glossaryHitsFind = (
	diff: string,
	aliases: GlossaryAlias[],
): GlossaryHit[] => {
	const patterns = aliases.map((a) => ({
		...a,
		pattern: new RegExp(`(?<![\\w-])${RegExp.escape(a.alias)}(?![\\w-])`, "i"),
	}));
	const hits: GlossaryHit[] = [];
	for (const added of diffAddedLines(diff)) {
		// The glossary itself names every alias on purpose.
		if (/(^|\/)CONTEXT\.md$/.test(added.file)) continue;
		for (const { alias, term, pattern } of patterns) {
			if (pattern.test(added.text)) {
				hits.push({ alias, file: added.file, line: added.line, term });
			}
		}
	}
	return hits;
};

export const glossaryHitFormat = (
	hit: GlossaryHit,
	actions: boolean,
): string =>
	actions
		? `::warning file=${hit.file},line=${hit.line}::"${hit.alias}" is an alias of "${hit.term}"`
		: `${hit.file}:${hit.line}: "${hit.alias}" is an alias of "${hit.term}"`;

const main = () => {
	try {
		const aliases = glossaryAliasesRead(readFileSync("CONTEXT.md", "utf8"));
		const diff = run("git", [
			"diff",
			"--unified=0",
			"--no-color",
			"origin/main",
			"--",
			".",
		]);
		const hits = glossaryHitsFind(diff, aliases);
		const actions = process.env.GITHUB_ACTIONS === "true";
		for (const hit of hits) console.log(glossaryHitFormat(hit, actions));
		if (hits.length === 0)
			console.log("glossary-check: no aliases in added lines");
	} catch (error) {
		console.log(`glossary-check: skipped (${(error as Error).message})`);
	}
};

if (import.meta.main) main();
