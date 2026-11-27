// pnpm glossary-check [map] [tree]: fails on words the glossaries rule out, in lines added against
// origin/main under the tree (default "."). The map (default CONTEXT-MAP.md) lists the app's
// glossaries: CONTEXT.md, the architecture terms every file shares, and each bounded context's
// own src/contexts/<context>/CONTEXT.md. A file in a context is held to the architecture terms
// and that context's language: an `_Avoid_:` alias of either, or another context's term, is a hit.
// Another context's term is fine in the adapters/ of a context the map lists downstream of it,
// and anywhere in a context that has an ACL to its context or whose own CONTEXT.md uses the term.
// Other files (UI, entry points) are held to every glossary's aliases. Given a glossary
// instead of a map (Baseline runs it over the monorepo with its root CONTEXT.md), that glossary
// holds every file. Only prose counts: comments and string literals in code files, every line of
// other text files; migrations, JSON, the glossaries and a string that is the value of `kind:`,
// in code or quoted in text, are skipped. A glossary term on the line is blanked first, so "Event
// key" is no hit for an alias "Event"; an alias written capitalized ("DTO") matches only that case,
// so "dto" passes; an `_Allowed until <when>_:` line lists aliases not checked yet. A hit fails
// the run (exit 1), as does a crash or wrong arguments: CI treats the check as blocking.
// The code lives in glossary-check-*.ts modules, one per concern, and this file keeps the CLI and
// re-exports their names.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { argsParse, argsUsageFail } from "./args.ts";
import { glossaryHitFormat, glossaryHitsFind } from "./glossary-check-hits.ts";
import {
	type GlossaryLanguage,
	glossaryLanguageOf,
	glossaryLanguageRead,
} from "./glossary-check-language.ts";
import { contextMapRead } from "./glossary-check-map.ts";
import { processRun } from "./process-run.ts";

export {
	glossaryDiffAddedLines,
	glossaryHitFormat,
	glossaryHitsFind,
} from "./glossary-check-hits.ts";
export {
	type GlossaryLanguage,
	glossaryAliasesRead,
	glossaryLanguageOf,
	glossaryLanguageRead,
	glossaryTermsRead,
} from "./glossary-check-language.ts";
export {
	type ContextMap,
	contextMapRead,
	contextMapViolations,
} from "./glossary-check-map.ts";
export { glossaryProseLines } from "./glossary-check-prose.ts";

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

const usage = `Usage: pnpm glossary-check [map] [tree]

Fails on words the glossaries rule out, in lines added against origin/main under the tree.

  map   the app's CONTEXT-MAP.md (default), or one CONTEXT.md that holds every file
  tree  the folder to check (default ".")
  -h, --help  this help`;

const main = () => {
	const parsed = argsParse({ allowPositionals: true, options: {}, usage });
	if (parsed === undefined) return;
	if (parsed.positionals.length > 2) {
		argsUsageFail(usage);
		return;
	}
	const [glossary = "CONTEXT-MAP.md", tree = "."] = parsed.positionals;
	try {
		const languageOf = languageOfRead(glossary);
		const diff = processRun({
			command: "git",
			args: ["diff", "--unified=0", "--no-color", "origin/main", "--", tree],
		});
		const root = processRun({
			command: "git",
			args: ["rev-parse", "--show-toplevel"],
		}).trim();
		const hits = glossaryHitsFind({
			diff,
			languageOf,
			textRead: (file) => readFileSync(join(root, file), "utf8"),
		});
		const actions = process.env["GITHUB_ACTIONS"] === "true";
		for (const hit of hits) console.log(glossaryHitFormat(hit, actions));
		if (hits.length === 0)
			console.log("glossary-check: no hits in added lines");
		else process.exitCode = 1;
	} catch (error) {
		console.error(`glossary-check: failed (${(error as Error).message})`);
		process.exitCode = 1;
	}
};

if (import.meta.main) main();
