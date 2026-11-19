// pnpm glossary-check [map] [tree]: warns on words the glossaries rule out, in lines added against
// origin/main under the tree (default "."). The map (default CONTEXT-MAP.md) lists the app's
// glossaries: CONTEXT.md, the architecture terms every file shares, and each bounded context's
// own src/contexts/<context>/CONTEXT.md. A file in a context is held to the architecture terms
// and that context's language: an `_Avoid_:` alias of either, or another context's term, is a hit.
// Another context's term is fine in the adapters/ of a context the map lists downstream of it.
// Other files (UI, composition roots) are held to every glossary's aliases. Given a glossary
// instead of a map (Baseline runs it over the monorepo with its root CONTEXT.md), that glossary
// holds every file. Only prose counts: comments and string literals in code files, every line of
// other text files; migrations, JSON, the glossaries and a string that is the value of `kind:`,
// in code or quoted in text, are skipped. A glossary term on the line is blanked first, so "Event
// key" is no hit for an alias "Event"; an alias written capitalized ("DTO") matches only that case,
// so "dto" passes; an `_Allowed until <when>_:` line lists aliases not checked yet. Warnings only: the agent judges
// each hit, so it always exits 0.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { codeFileIs, modesRead, run } from "./template-render.ts";

type GlossaryAlias = { alias: string; term: string };

// The words a file is held to: the aliases it must not use, the terms blanked before they are
// matched, and the terms of other contexts with the context each belongs to.
export type GlossaryLanguage = {
	aliases: GlossaryAlias[];
	foreign: { context: string; term: string }[];
	terms: string[];
};

// `context` is set when the word is another context's term rather than an alias.
type GlossaryHit = GlossaryAlias & {
	context?: string;
	file: string;
	line: number;
};

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

// Every `**Term**:` heading, longest first, so a term that holds an alias ("Event key") is
// blanked before the alias ("Event") is matched.
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
	/(^|\/)CONTEXT(-MAP)?\.md$/.test(file) ||
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

const kindValuePattern = /\bkind:\s*(["'])[^"'\n]*\1/g;

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

// The words one glossary rules out, for every file.
export const glossaryLanguageRead = (glossary: string): GlossaryLanguage => ({
	aliases: glossaryAliasesRead(glossary),
	foreign: [],
	terms: glossaryTermsRead(glossary),
});

export const contextSubdomains = ["core", "supporting", "generic"];

const contextThroughs = ["ACL", "Domain events"];

export type ContextMap = {
	contexts: { context: string; glossary: string; subdomain: string }[];
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

// CONTEXT-MAP.md: a `## Contexts` table (Context | Subdomain | Language) and a `## Relationships`
// table (Downstream | Upstream | Through). docs/agents/context-create.md gives the format.
export const contextMapRead = (map: string): ContextMap => ({
	contexts: tableRowsRead(map, "Contexts").map(
		([context, subdomain, glossary]) => ({
			context: cellText(context),
			glossary: cellText(glossary),
			subdomain: cellText(subdomain),
		}),
	),
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

const longestFirst = (terms: string[]): string[] =>
	[...terms].sort((a, b) => b.length - a.length);

// The language each file is held to, by its path: a context's files get the shared glossaries
// and their own context's; its adapters/ may also use the terms of the contexts it is downstream
// of; every other file gets every glossary's aliases.
export const glossaryLanguageOf = ({
	glossaryRead,
	map,
}: {
	glossaryRead: (path: string) => string;
	map: ContextMap;
}): ((file: string) => GlossaryLanguage) => {
	const own = new Set(map.contexts.map((c) => c.glossary));
	const shared = map.glossaries
		.filter((g) => !own.has(g))
		.map((g) => glossaryLanguageRead(glossaryRead(g)));
	const contexts = map.contexts.map((c) => ({
		...c,
		language: glossaryLanguageRead(glossaryRead(c.glossary)),
	}));
	const sharedAliases = shared.flatMap((l) => l.aliases);
	const sharedTerms = shared.flatMap((l) => l.terms);
	const every: GlossaryLanguage = {
		aliases: [...sharedAliases, ...contexts.flatMap((c) => c.language.aliases)],
		foreign: [],
		terms: longestFirst([
			...sharedTerms,
			...contexts.flatMap((c) => c.language.terms),
		]),
	};
	const byContext = new Map(
		contexts.map((c) => {
			const terms = [...c.language.terms, ...sharedTerms];
			const known = new Set(terms.map((t) => t.toLowerCase()));
			const foreign = contexts
				.filter((other) => other.context !== c.context)
				.flatMap((other) =>
					other.language.terms.map((term) => ({
						context: other.context,
						term,
					})),
				)
				.filter((f) => !known.has(f.term.toLowerCase()));
			const upstreams = new Set(
				map.relationships
					.filter((r) => r.downstream === c.context)
					.map((r) => r.upstream),
			);
			const inner: GlossaryLanguage = {
				aliases: [...sharedAliases, ...c.language.aliases],
				foreign,
				terms: longestFirst(terms),
			};
			const adapters: GlossaryLanguage = {
				...inner,
				foreign: foreign.filter((f) => !upstreams.has(f.context)),
			};
			return [c.context, { adapters, inner }] as const;
		}),
	);
	return (file) => {
		const [, context = "", rest = ""] =
			/(?:^|\/)src\/contexts\/([^/]+)\/(.*)$/.exec(file) ?? [];
		const language = byContext.get(context);
		if (language === undefined) return every;
		return rest.startsWith("adapters/") ? language.adapters : language.inner;
	};
};

// Not inside a word or a path: test/integration, test:integration and integration.test.ts are
// no hit for "integration". A word written capitalized ("DTO", another context's "Golfer")
// matches only as written, as prose writes a glossary term; "an architecture rule" and "a golfer id" pass.
// `plural` also takes "Golfers".
const wordPattern = ({
	global = "",
	plural = "",
	word,
}: {
	global?: string;
	plural?: string;
	word: string;
}): RegExp =>
	new RegExp(
		`(?<![\\w-]|[/.:])${RegExp.escape(word)}${plural}(?![\\w-]|[/.]\\w)`,
		`${global}${/^[a-z]/.test(word) ? "i" : ""}`,
	);

type LanguagePatterns = {
	aliases: (GlossaryAlias & { pattern: RegExp })[];
	// Longest first: blanked in turn, and a hit when the word is another context's.
	words: { context?: string; pattern: RegExp; term: string }[];
};

const languagePatterns = (language: GlossaryLanguage): LanguagePatterns => ({
	aliases: language.aliases.map((a) => ({
		...a,
		pattern: wordPattern({ word: a.alias }),
	})),
	words: [
		...language.terms.map((term) => ({
			// "Event keys" is the term "Event key", not an alias "Event".
			pattern: new RegExp(
				`(?<![\\w-])${RegExp.escape(term)}(?:e?s)?(?![\\w-])`,
				"gi",
			),
			term,
		})),
		...language.foreign.map(({ context, term }) => ({
			context,
			pattern: wordPattern({ global: "g", plural: "(?:e?s)?", word: term }),
			term,
		})),
	].sort((a, b) => b.term.length - a.term.length),
});

export const glossaryHitsFind = ({
	diff,
	languageOf,
	textRead,
}: {
	diff: string;
	languageOf: (file: string) => GlossaryLanguage;
	textRead: (file: string) => string;
}): GlossaryHit[] => {
	const compiled = new Map<GlossaryLanguage, LanguagePatterns>();
	const hits: GlossaryHit[] = [];
	const proses = new Map<string, string[] | null>();
	for (const added of glossaryDiffAddedLines(diff)) {
		// The glossaries and the map name every alias and term on purpose.
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
		} else {
			// A Markdown line quoting code (`kind: "client"`) skips the `kind:` value, as code does.
			prose = prose.replace(kindValuePattern, (value) => " ".repeat(value.length));
		}
		const language = languageOf(added.file);
		let patterns = compiled.get(language);
		if (patterns === undefined) {
			patterns = languagePatterns(language);
			compiled.set(language, patterns);
		}
		const at = { file: added.file, line: added.line };
		for (const { context, pattern, term } of patterns.words) {
			prose = prose.replace(pattern, (word) => {
				if (context !== undefined) {
					hits.push({ ...at, alias: word, context, term });
				}
				return " ".repeat(word.length);
			});
		}
		for (const { alias, term, pattern } of patterns.aliases) {
			if (pattern.test(prose)) hits.push({ ...at, alias, term });
		}
	}
	return hits;
};

export const glossaryHitFormat = (
	hit: GlossaryHit,
	actions: boolean,
): string => {
	const message =
		hit.context === undefined
			? `"${hit.alias}" is an alias of "${hit.term}"`
			: `"${hit.alias}" is a term of the ${hit.context} context`;
	return actions
		? `::warning file=${hit.file},line=${hit.line}::${message}`
		: `${hit.file}:${hit.line}: ${message}`;
};

// What is wrong with an app's glossaries: CONTEXT.md holds only the shared terms, CONTEXT-MAP.md
// has one row per folder in src/contexts/ with a subdomain type and its CONTEXT.md, that file says
// the same subdomain, and each relationship joins two listed contexts through an ACL,
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
	for (const { context, glossary, subdomain } of parsed.contexts) {
		const path = `src/contexts/${context}/CONTEXT.md`;
		if (!contextSubdomains.includes(subdomain)) {
			problems.push(
				`CONTEXT-MAP.md: ${context}'s subdomain is core, supporting or generic, not "${subdomain}"`,
			);
		}
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
		const text = glossaryRead(path);
		if (!contextSubdomains.includes(subdomain)) continue;
		if (text === undefined) {
			problems.push(`${path}: add ${context}'s language`);
		} else if (/^Subdomain: (.*)$/m.exec(text)?.[1]?.trim() !== subdomain) {
			problems.push(
				`${path}: say "Subdomain: ${subdomain}" under the title, as CONTEXT-MAP.md does`,
			);
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

// The language of each file under a map, or of one glossary for every file.
const languageOfRead = (
	glossary: string,
): ((file: string) => GlossaryLanguage) => {
	const text = readFileSync(glossary, "utf8");
	if (!/(^|\/)CONTEXT-MAP\.md$/.test(glossary)) {
		const language = glossaryLanguageRead(text);
		return () => language;
	}
	return glossaryLanguageOf({
		glossaryRead: (path) => {
			// A glossary the map links but the tree lacks holds nothing; the map's test says so.
			try {
				return readFileSync(join(dirname(glossary), path), "utf8");
			} catch {
				return "";
			}
		},
		map: contextMapRead(text),
	});
};

const main = (
	[glossary = "CONTEXT-MAP.md", tree = "."] = process.argv.slice(2),
) => {
	try {
		const languageOf = languageOfRead(glossary);
		const diff = run({
			command: "git",
			args: ["diff", "--unified=0", "--no-color", "origin/main", "--", tree],
		});
		const root = run({
			command: "git",
			args: ["rev-parse", "--show-toplevel"],
		}).trim();
		const hits = glossaryHitsFind({
			diff,
			languageOf,
			textRead: (file) => readFileSync(join(root, file), "utf8"),
		});
		const actions = process.env.GITHUB_ACTIONS === "true";
		for (const hit of hits) console.log(glossaryHitFormat(hit, actions));
		if (hits.length === 0)
			console.log("glossary-check: no hits in added lines");
	} catch (error) {
		console.log(`glossary-check: skipped (${(error as Error).message})`);
	}
};

if (import.meta.main) main();
