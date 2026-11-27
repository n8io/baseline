// glossary-check's hits: the words an added line uses that the glossaries rule out.
import {
	type GlossaryAlias,
	type GlossaryLanguage,
	wordPattern,
} from "./glossary-check-language.ts";
import {
	glossaryProseLines,
	glossarySkipIs,
	kindValuePattern,
} from "./glossary-check-prose.ts";
import { fileIsCode } from "./template-render.ts";

// `context` is set when the word is another context's term rather than an alias.
type GlossaryHit = GlossaryAlias & {
	context?: string;
	file: string;
	line: number;
};

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
		if (fileIsCode(added.file)) {
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
			// A text file line quoting code (`kind: "client"`) skips the `kind:` value, as code does.
			prose = prose.replace(kindValuePattern, (value) =>
				" ".repeat(value.length),
			);
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
