import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	contextMapRead,
	contextMapViolations,
	type GlossaryLanguage,
	glossaryAliasesRead,
	glossaryDiffAddedLines,
	glossaryHitFormat,
	glossaryHitsFind,
	glossaryLanguageOf,
	glossaryLanguageRead,
} from "./glossary-check.ts";

import.meta.glob(
	["../CONTEXT.md", "../CONTEXT-MAP.md", "../src/contexts/*/CONTEXT.md"],
	{ query: "?raw" },
);

const appRoot = new URL("../", import.meta.url);

// One language for every file, as a single glossary gives.
const everyFile =
	(language: Partial<GlossaryLanguage>) => (): GlossaryLanguage => ({
		aliases: [],
		foreign: [],
		terms: [],
		...language,
	});

const context = [
	"# A project.",
	"",
	"## Architecture",
	"",
	"**Live update**:",
	"A short note.",
	"_Avoid_: push, real-time event",
	"",
	"## Language",
	"",
	"**Invoice line**:",
	"One line of an invoice.",
	"_Avoid_: item",
].join("\n");

const diff = [
	"diff --git a/src/a.ts b/src/a.ts",
	"--- a/src/a.ts",
	"+++ b/src/a.ts",
	"@@ -3,0 +4,2 @@",
	"+// Sends a Push to every item.",
	"+const pushed = items;",
	"@@ -10 +12 @@",
	"-old",
	"+// a real-time event",
	"diff --git a/CONTEXT.md b/CONTEXT.md",
	"+++ b/CONTEXT.md",
	"@@ -1 +1 @@",
	"+_Avoid_: push",
].join("\n");

describe("glossary-check", () => {
	it("reads every alias with its term from both sections", () => {
		expect(glossaryAliasesRead(context)).toEqual([
			{ alias: "push", term: "Live update" },
			{ alias: "real-time event", term: "Live update" },
			{ alias: "item", term: "Invoice line" },
		]);
	});

	it("leaves out the aliases an _Allowed until_ line names", () => {
		const moving = [
			"_Allowed until #1 (2026-01-01)_: Tome, Old ledger",
			"",
			"**Book**:",
			"A bound record.",
			"_Avoid_: tome, volume",
			"",
			"**Ledger**:",
			"Lists entries.",
			"_Avoid_: Old ledger, tally",
		].join("\n");
		expect(glossaryAliasesRead(moving)).toEqual([
			{ alias: "volume", term: "Book" },
			{ alias: "tally", term: "Ledger" },
		]);
	});

	it("finds no alias inside a longer glossary term", () => {
		const terms = [
			"**Book**:",
			"A bound record.",
			"_Avoid_: tome",
			"",
			"**Tome shelf**:",
			"Where books stand.",
		].join("\n");
		const added = [
			"+++ b/src/a.ts",
			"@@ -0,0 +1,2 @@",
			"+// Put it on the tome shelf.",
			"+// Read the tome.",
		].join("\n");
		expect(
			glossaryHitsFind({
				diff: added,
				languageOf: () => glossaryLanguageRead(terms),
				textRead: () => "// Put it on the tome shelf.\n// Read the tome.\n",
			}).map((hit) => hit.line),
		).toEqual([2]);
	});

	it("numbers added lines as they are in the new file", () => {
		expect(glossaryDiffAddedLines(diff).slice(0, 3)).toEqual([
			{ file: "src/a.ts", line: 4, text: "// Sends a Push to every item." },
			{ file: "src/a.ts", line: 5, text: "const pushed = items;" },
			{ file: "src/a.ts", line: 12, text: "// a real-time event" },
		]);
	});

	it("finds whole-word hits in any case and skips CONTEXT.md", () => {
		const hits = glossaryHitsFind({
			diff,
			languageOf: everyFile({ aliases: glossaryAliasesRead(context) }),
			textRead: () =>
				"\n\n\n// Sends a Push to every item.\nconst pushed = items;\n\n\n\n\n\n\n// a real-time event",
		});

		expect(hits.map((h) => `${h.line} ${h.alias}`)).toEqual([
			"4 push",
			"4 item",
			"12 real-time event",
		]);
	});

	it("skips an alias inside a path or script name but not at a sentence end", () => {
		const aliases = [{ alias: "integration", term: "Bridge" }];
		const pathDiff = [
			"+++ b/src/a.ts",
			"@@ -0,0 +1,3 @@",
			"+import { db } from '../test/integration/db.ts';",
			"+// see integration.test.ts, then run pnpm test:integration",
			"+// Calls the integration.",
		].join("\n");
		const pathText = [
			"import { db } from '../test/integration/db.ts';",
			"// see integration.test.ts, then run pnpm test:integration",
			"// Calls the integration.",
		].join("\n");

		expect(
			glossaryHitsFind({
				diff: pathDiff,
				languageOf: everyFile({ aliases }),
				textRead: () => pathText,
			}).map((h) => h.line),
		).toEqual([3]);
	});

	it("prints a GitHub annotation in Actions and a plain line elsewhere", () => {
		const hit = {
			alias: "push",
			file: "src/a.ts",
			line: 4,
			term: "Live update",
		};

		expect(glossaryHitFormat(hit, true)).toBe(
			'::warning file=src/a.ts,line=4::"push" is an alias of "Live update"',
		);
		expect(glossaryHitFormat(hit, false)).toBe(
			'src/a.ts:4: "push" is an alias of "Live update"',
		);
	});

	describe("prose only", () => {
		const aliases = [
			{ alias: "client", term: "Machine client" },
			{ alias: "schema", term: "Table" },
			{ alias: "main", term: "Entry" },
		];
		const hitsIn = (file: string, text: string): number[] =>
			glossaryHitsFind({
				languageOf: everyFile({ aliases }),
				diff: [
					`+++ b/${file}`,
					`@@ -0,0 +1,${text.split("\n").length} @@`,
					...text.split("\n").map((row) => `+${row}`),
				].join("\n"),
				textRead: () => text,
			}).map((hit) => hit.line);

		it("skips migrations and JSON files", () => {
			expect(hitsIn("src/migrations/0001.sql", "-- the client schema")).toEqual(
				[],
			);
			expect(
				hitsIn("drizzle/meta/0001_snapshot.json", '"schema": "client"'),
			).toEqual([]);
		});

		it("skips identifiers, keys, JSX element names and a kind value", () => {
			const text = [
				"const row = { schema: table, client: null };",
				"const page = <main>{value}</main>;",
				'const token = { kind: "client" };',
			].join("\n");

			expect(hitsIn("src/a.tsx", text)).toEqual([]);
		});

		it("reads JSX text, on one line and across lines, and leaves code that looks like it", () => {
			const text = [
				"const page = (",
				"	<section>",
				"		<p>The client schema</p>",
				"		<p>",
				"			Sign in as a client",
				"		</p>",
				"		<p>Welcome to main, {name}</p>",
				"	</section>",
				");",
				"const tail = (a: number) => a > 1 && a < 3;",
				"const kind: Map<string, number> = new Map();",
				"const main = (client: Array<string>) => client.length > 2 ? 1 : 0;",
			].join("\n");

			expect(hitsIn("src/a.tsx", text)).toEqual([3, 3, 5, 7]);
			expect(hitsIn("src/a.ts", text)).toEqual([]);
		});

		it("reads multi-line comments and template literals line by line", () => {
			const text = [
				"/*",
				" the client",
				" */",
				"const a = `",
				"the schema`;",
			].join("\n");

			expect(hitsIn("src/a.ts", text)).toEqual([2, 5]);
		});

		it("still finds an alias in a comment or a string", () => {
			const text = [
				"// the client",
				'const label = "the schema";',
				"const note = `an main`;",
			].join("\n");

			expect(hitsIn("src/a.ts", text)).toEqual([1, 2, 3]);
		});

		it("tests every line of a text file", () => {
			expect(hitsIn("docs/a.md", "the client\nnothing")).toEqual([1]);
		});
	});
});

describe("an alias written capitalized", () => {
	it("matches only as written, so a plain English word passes", () => {
		const text = "// A Rule holds.\n// An architecture rule holds.\n";
		const hits = glossaryHitsFind({
			diff: "+++ b/src/a.ts\n@@ -0,0 +1,2 @@\n+x\n+y",
			languageOf: everyFile({
				aliases: [{ alias: "Rule", term: "Invariant" }],
			}),
			textRead: () => text,
		});

		expect(hits.map((h) => h.line)).toEqual([1]);
	});

	it("leaves a lower-case alias matching in any case", () => {
		const hits = glossaryHitsFind({
			diff: "+++ b/src/a.ts\n@@ -0,0 +1,2 @@\n+x\n+y",
			languageOf: everyFile({
				aliases: [{ alias: "service", term: "Use case" }],
			}),
			textRead: () => "// the billing service\n// A Service.\n",
		});

		expect(hits.map((h) => h.line)).toEqual([1, 2]);
	});
});

describe("a plural", () => {
	it("is its term, so it holds no alias", () => {
		const glossary =
			"**Domain event**:\nA fact.\n\n**Bounded context**:\nA scope.\n_Avoid_: Domain\n";
		const hits = glossaryHitsFind({
			diff: "+++ b/src/a.ts\n@@ -0,0 +1,2 @@\n+x\n+y",
			languageOf: () => glossaryLanguageRead(glossary),
			textRead: () => "// Publishes Domain events.\n// One Domain.\n",
		});

		expect(hits.map((h) => h.line)).toEqual([2]);
	});
});

// A sample app: league reads tour through an ACL. Each has its own language.
const sampleMap = [
	"# Context map",
	"",
	"[CONTEXT.md](CONTEXT.md) holds the shared terms.",
	"",
	"## Contexts",
	"",
	"| Context  | Subdomain  | Language                                                     |",
	"| -------- | ---------- | ------------------------------------------------------------ |",
	"| `league` | core       | [src/contexts/league/CONTEXT.md](src/contexts/league/CONTEXT.md) |",
	"| `tour`   | supporting | [src/contexts/tour/CONTEXT.md](src/contexts/tour/CONTEXT.md)     |",
	"",
	"## Relationships",
	"",
	"| Downstream | Upstream | Through            |",
	"| ---------- | -------- | ------------------ |",
	"| `league`   | `tour`   | ACL, Domain events |",
	"",
].join("\n");

const sampleGlossaries: Record<string, string> = {
	"CONTEXT.md": "**Use case**:\nOne operation.\n_Avoid_: Service\n",
	"src/contexts/league/CONTEXT.md":
		"# League\n\nSubdomain: core\n\n## Language\n\n**Roster**:\nA team's golfers.\n_Avoid_: lineup\n",
	"src/contexts/tour/CONTEXT.md":
		"# Tour\n\nSubdomain: supporting\n\n## Language\n\n**Golfer**:\nA player on tour.\n\n**Score**:\nStrokes in a round.\n",
};

describe("the context map", () => {
	it("reads its contexts, relationships and glossaries", () => {
		expect(contextMapRead(sampleMap)).toEqual({
			contexts: [
				{
					context: "league",
					glossary: "src/contexts/league/CONTEXT.md",
					subdomain: "core",
				},
				{
					context: "tour",
					glossary: "src/contexts/tour/CONTEXT.md",
					subdomain: "supporting",
				},
			],
			glossaries: [
				"CONTEXT.md",
				"src/contexts/league/CONTEXT.md",
				"src/contexts/tour/CONTEXT.md",
			],
			relationships: [
				{
					downstream: "league",
					through: ["ACL", "Domain events"],
					upstream: "tour",
				},
			],
		});
	});

	it("reads a Language cell given as a path", () => {
		const map = sampleMap.replace(
			"[src/contexts/tour/CONTEXT.md](src/contexts/tour/CONTEXT.md)",
			"`src/contexts/tour/CONTEXT.md`",
		);
		expect(contextMapRead(map).contexts[1]?.glossary).toBe(
			"src/contexts/tour/CONTEXT.md",
		);
	});

	describe("glossary-check over it", () => {
		const languageOf = glossaryLanguageOf({
			glossaryRead: (path) => sampleGlossaries[path] ?? "",
			map: contextMapRead(sampleMap),
		});
		const hitsIn = (file: string, line: string) =>
			glossaryHitsFind({
				diff: `+++ b/apps/app/${file}\n@@ -0,0 +1 @@\n+${line}`,
				languageOf,
				textRead: () => line,
			}).map((hit) => glossaryHitFormat(hit, false));

		it("passes a context's own terms and the shared ones", () => {
			expect(
				hitsIn(
					"src/contexts/league/domain/roster.md",
					"A Use case adds a golfer id to the Roster.",
				),
			).toEqual([]);
		});

		it("fails another context's term and either glossary's aliases", () => {
			expect(
				hitsIn(
					"src/contexts/league/domain/roster.md",
					"The Service sets the lineup from the Golfers' Score.",
				),
			).toEqual([
				'apps/app/src/contexts/league/domain/roster.md:1: "Golfers" is a term of the tour context',
				'apps/app/src/contexts/league/domain/roster.md:1: "Score" is a term of the tour context',
				'apps/app/src/contexts/league/domain/roster.md:1: "Service" is an alias of "Use case"',
				'apps/app/src/contexts/league/domain/roster.md:1: "lineup" is an alias of "Roster"',
			]);
		});

		it("lets the adapters of a downstream context name its upstream's terms", () => {
			expect(
				hitsIn(
					"src/contexts/league/adapters/outbound/league-tour-acl.md",
					"Turns each Golfer into a roster pick.",
				),
			).toEqual([]);
			expect(
				hitsIn(
					"src/contexts/tour/adapters/outbound/tour-league-acl.md",
					"Reads the Roster.",
				),
			).toEqual([
				'apps/app/src/contexts/tour/adapters/outbound/tour-league-acl.md:1: "Roster" is a term of the league context',
			]);
		});

		it("holds files outside the contexts to every glossary's aliases", () => {
			expect(
				hitsIn("src/ui/routes/home.md", "The lineup and the Golfer."),
			).toEqual([
				'apps/app/src/ui/routes/home.md:1: "lineup" is an alias of "Roster"',
			]);
		});
	});

	describe("contextMapViolations", () => {
		const violations = (
			change: Partial<Parameters<typeof contextMapViolations>[0]> = {},
		) =>
			contextMapViolations({
				appGlossary: sampleGlossaries["CONTEXT.md"] ?? "",
				contexts: ["league", "tour"],
				glossaryRead: (path) => sampleGlossaries[path],
				map: sampleMap,
				...change,
			});

		it("passes the sample", () => {
			expect(violations()).toEqual([]);
		});

		it.each([
			[
				"terms left under the app's ## Language",
				{ appGlossary: "**Use case**:\nx\n\n## Language\n\n**Golfer**:\nx\n" },
				"CONTEXT.md: move each term under ## Language",
			],
			[
				"a context folder with no row",
				{ contexts: ["league", "tour", "billing"] },
				"CONTEXT-MAP.md: add a row for billing under ## Contexts",
			],
			[
				"a row with no context folder",
				{ contexts: ["league"] },
				"CONTEXT-MAP.md: there is no src/contexts/tour/",
			],
			[
				"an unknown subdomain type",
				{ map: sampleMap.replace("| core       |", "| main       |") },
				'league\'s subdomain is core, supporting or generic, not "main"',
			],
			[
				"a context glossary with another subdomain",
				{
					glossaryRead: (path: string) =>
						sampleGlossaries[path]?.replace(
							"Subdomain: supporting",
							"Subdomain: core",
						),
				},
				'src/contexts/tour/CONTEXT.md: say "Subdomain: supporting"',
			],
			[
				"a context with no glossary",
				{
					glossaryRead: (path: string) =>
						path.includes("tour") ? undefined : sampleGlossaries[path],
				},
				"src/contexts/tour/CONTEXT.md: add tour's language",
			],
			[
				"a relationship to an unlisted context",
				{ map: sampleMap.replace("| `tour`   | ACL", "| `crm`    | ACL") },
				"crm is not under ## Contexts",
			],
			[
				"a relationship through something else",
				{ map: sampleMap.replace("ACL, Domain events", "Shared database  ") },
				"Through is ACL, Domain events or both",
			],
			[
				"a map that does not link CONTEXT.md",
				{ map: sampleMap.replace("[CONTEXT.md](CONTEXT.md)", "CONTEXT.md") },
				"CONTEXT-MAP.md: link CONTEXT.md",
			],
		])("fails on %s", (_name, change, message) => {
			expect(violations(change)).toEqual([expect.stringContaining(message)]);
		});

		it("holds for the real tree", () => {
			const contexts = new URL("src/contexts/", appRoot);
			const read = (path: string) => {
				const url = new URL(path, appRoot);
				return existsSync(url) ? readFileSync(url, "utf8") : undefined;
			};
			expect(
				contextMapViolations({
					appGlossary: read("CONTEXT.md") ?? "",
					contexts: readdirSync(contexts, { withFileTypes: true })
						.filter((d) => d.isDirectory())
						.map((d) => d.name),
					glossaryRead: read,
					map: read("CONTEXT-MAP.md") ?? "",
				}),
			).toEqual([]);
		});
	});
});
