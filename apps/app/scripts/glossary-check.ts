// pnpm glossary-check [glossary] [tree]: warns on every `_Avoid_:` alias from the glossary
// (default CONTEXT.md) in lines added against origin/main under the tree (default "."). Baseline runs
// it over the monorepo with its root CONTEXT.md. Only prose counts: comments and string literals in
// code files, every line of other text files; migrations, JSON and a string that is the value of
// `kind:` are skipped. A glossary term on the line is blanked first, so "Domain event" is no hit for
// "Domain"; an `_Allowed until <when>_:` line in the glossary lists aliases not checked yet. Warnings only: the agent judges each hit, so it always exits 0.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeFileIs, modesRead, run } from "./template-render.ts";

type GlossaryAlias = { alias: string; term: string };

type GlossaryHit = GlossaryAlias & { file: string; line: number };

// Every `_Avoid_:` alias with the `**Term**:` it belongs to, from both sections. An alias an
// `_Allowed until <when>_:` line names is left out: old words the code still uses while it moves.
export const glossaryAliasesRead = (context: string): GlossaryAlias[] => {
	const aliases: GlossaryAlias[] = [];
	const allowed = new Set<string>();
	let term: string | undefined;
	for (const line of context.split("\n")) {
		const allow = /^_Allowed until [^_]+_:\s*(.+)$/.exec(line);
		for (const alias of allow?.[1]?.split(",") ?? []) {
			allowed.add(alias.trim().toLowerCase());
		}
		const heading = /^\*\*(.+)\*\*:\s*$/.exec(line);
		if (heading?.[1] !== undefined) term = heading[1];
		const avoid = /^_Avoid_:\s*(.+)$/.exec(line);
		if (avoid?.[1] === undefined || term === undefined) continue;
		for (const alias of avoid[1].split(",")) {
			const trimmed = alias.trim();
			if (trimmed !== "") aliases.push({ alias: trimmed, term });
		}
	}
	return aliases.filter((a) => !allowed.has(a.alias.toLowerCase()));
};

// Every `**Term**:` heading, longest first, so a term that holds an alias ("Domain event") is
// blanked before the alias ("Domain") is matched.
export const glossaryTermsRead = (context: string): string[] =>
	[...context.matchAll(/^\*\*(.+)\*\*:\s*$/gm)]
		.map((m) => m[1] ?? "")
		.sort((a, b) => b.length - a.length);

// The added lines of a unified diff, with their file and line number in the new version.
export const glossaryDiffAddedLines = (
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

const glossarySkipIs = (file: string): boolean =>
	/(^|\/)CONTEXT\.md$/.test(file) ||
	/(^|\/)migrations\//.test(file) ||
	file.endsWith(".json");

// Every line of a code file with everything but prose blanked: only comments and string literals
// stay (a string that is a `kind:` value does not), so identifiers, keys and JSX element names never
// match. The lexer reads JSX text as code, so a .tsx file also keeps what sits between a tag's `>` and
// the next `<` or `{` (jsxTextIs; text after a `{...}` is not read). Lexed once per file.
// A tag's `>` follows a name, a quote or a `}`; text then runs to the next `<` or `{`. Operators
// (`=>`, `>=`), generics followed by a call or an assignment, and code with `;` `=` `|` `(` `)` do not match.
const jsxTextPattern =
	/(?<=[\w"'}\]])>([^<>{};=|&()]*[A-Za-z][^<>{};=|&()]*)(?=[<{])/g;

const codeIs = (mode: string | undefined): boolean =>
	mode === undefined || mode === "code";

const jsxTextIs = ({
	modes,
	text,
}: {
	modes: ReturnType<typeof modesRead>;
	text: string;
}): boolean[] => {
	const is = new Array<boolean>(text.length).fill(false);
	for (const m of text.matchAll(jsxTextPattern)) {
		const from = m.index + 1;
		const to = from + (m[1]?.length ?? 0);
		// Only code counts: a `>` inside a string or comment starts no tag.
		if (!codeIs(modes[m.index])) continue;
		for (let k = from; k < to; k++) is[k] = codeIs(modes[k]);
	}
	return is;
};

export const glossaryProseLines = ({
	file,
	text,
}: {
	file: string;
	text: string;
}): string[] => {
	const modes = modesRead(text, file);
	const skipped = new Map<number, boolean>();
	const kindValueIs = (index: number): boolean => {
		let from = index;
		while (from > 0 && modes[from - 1] === "string") from--;
		let value = skipped.get(from);
		if (value === undefined) {
			value = /\bkind:\s*$/.test(text.slice(Math.max(0, from - 40), from));
			skipped.set(from, value);
		}
		return value;
	};
	const jsx = file.endsWith(".tsx")
		? jsxTextIs({ modes, text })
		: new Array<boolean>(text.length).fill(false);
	let prose = "";
	for (let i = 0; i < text.length; i++) {
		const mode = modes[i];
		const keep =
			text[i] === "\n" ||
			jsx[i] === true ||
			mode === "comment" ||
			(mode === "string" && !kindValueIs(i));
		prose += keep ? (text[i] ?? " ") : " ";
	}
	return prose.split("\n");
};

export const glossaryHitsFind = ({
	aliases,
	diff,
	terms,
	textRead,
}: {
	aliases: GlossaryAlias[];
	diff: string;
	terms?: string[] | null;
	textRead: (file: string) => string;
}): GlossaryHit[] => {
	const termPatterns = (terms ?? []).map(
		(term) => new RegExp(`(?<![\\w-])${RegExp.escape(term)}(?![\\w-])`, "gi"),
	);
	const patterns = aliases.map((a) => ({
		...a,
		// Not inside a word or a path: test/integration, test:integration and
		// integration.test.ts are no Bridge.
		pattern: new RegExp(
			`(?<![\\w-]|[/.:])${RegExp.escape(a.alias)}(?![\\w-]|[/.]\\w)`,
			"i",
		),
	}));
	const hits: GlossaryHit[] = [];
	const proses = new Map<string, string[] | null>();
	for (const added of glossaryDiffAddedLines(diff)) {
		// The glossary itself names every alias on purpose.
		if (glossarySkipIs(added.file)) continue;
		let prose = added.text;
		if (codeFileIs(added.file)) {
			let lines = proses.get(added.file);
			if (lines === undefined) {
				// A file that cannot be read (a renamed path prefix, a deleted file) is skipped alone.
				try {
					lines = glossaryProseLines({
						file: added.file,
						text: textRead(added.file),
					});
				} catch {
					lines = null;
				}
				proses.set(added.file, lines);
			}
			if (lines === null) continue;
			prose = lines[added.line - 1] ?? "";
		}
		for (const termPattern of termPatterns) {
			prose = prose.replace(termPattern, (term) => " ".repeat(term.length));
		}
		for (const { alias, term, pattern } of patterns) {
			if (pattern.test(prose)) {
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

const main = (
	[glossary = "CONTEXT.md", tree = "."] = process.argv.slice(2),
) => {
	try {
		const context = readFileSync(glossary, "utf8");
		const aliases = glossaryAliasesRead(context);
		const diff = run({
			command: "git",
			args: ["diff", "--unified=0", "--no-color", "origin/main", "--", tree],
		});
		const root = run({
			command: "git",
			args: ["rev-parse", "--show-toplevel"],
		}).trim();
		const hits = glossaryHitsFind({
			aliases,
			diff,
			terms: glossaryTermsRead(context),
			textRead: (file) => readFileSync(join(root, file), "utf8"),
		});
		const actions = process.env.GITHUB_ACTIONS === "true";
		for (const hit of hits) console.log(glossaryHitFormat(hit, actions));
		if (hits.length === 0)
			console.log("glossary-check: no aliases in added lines");
	} catch (error) {
		console.log(`glossary-check: skipped (${(error as Error).message})`);
	}
};

if (import.meta.main) main();
