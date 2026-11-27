// glossary-check's language: the words a glossary rules out, and the language each file is held to.
import type { ContextMap } from "./glossary-check-map.ts";

export type GlossaryAlias = { alias: string; term: string };

// The words a file is held to: the aliases it must not use, the terms blanked before they are
// matched, and the terms of other contexts with the context each belongs to.
export type GlossaryLanguage = {
	aliases: GlossaryAlias[];
	foreign: { context: string; term: string }[];
	terms: string[];
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
// The words one glossary rules out, for every file.
export const glossaryLanguageRead = (glossary: string): GlossaryLanguage => ({
	aliases: glossaryAliasesRead(glossary),
	foreign: [],
	terms: glossaryTermsRead(glossary),
});

export const longestFirst = (terms: string[]): string[] =>
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
			// Terms and definitions only: an `_Avoid_` line names words the context rules out.
			const ownText = glossaryRead(c.glossary)
				.split("\n")
				.filter((line) => !line.startsWith("_Avoid_"))
				.join("\n");
			const aclUpstreams = new Set(
				map.relationships
					.filter(
						(r) => r.downstream === c.context && r.through.includes("ACL"),
					)
					.map((r) => r.upstream),
			);
			const foreign = contexts
				.filter((other) => other.context !== c.context)
				.flatMap((other) =>
					other.language.terms.map((term) => ({
						context: other.context,
						term,
					})),
				)
				.filter((f) => !known.has(f.term.toLowerCase()))
				.filter((f) => !wordPattern({ word: f.term }).test(ownText));
			const upstreams = new Set(
				map.relationships
					.filter((r) => r.downstream === c.context)
					.map((r) => r.upstream),
			);
			const inner: GlossaryLanguage = {
				aliases: [...sharedAliases, ...c.language.aliases],
				foreign: foreign.filter((f) => !aclUpstreams.has(f.context)),
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
// matches only as written, as prose writes a glossary term; "a dto" and "a golfer id" pass.
// `plural` also takes "Golfers".
export const wordPattern = ({
	global,
	plural,
	word,
}: {
	global?: string | null;
	plural?: string | null;
	word: string;
}): RegExp =>
	new RegExp(
		`(?<![\\w-]|[/.:])${RegExp.escape(word)}${plural ?? ""}(?![\\w-]|[/.]\\w)`,
		`${global ?? ""}${/^[a-z]/.test(word) ? "i" : ""}`,
	);
