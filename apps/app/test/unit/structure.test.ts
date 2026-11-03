import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appRoot = new URL("../../", import.meta.url);

const termOf = (name: string) => {
	const [first = "", ...rest] = name.split("-");
	return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
};

const structureViolations = (paths: string[], context: string): string[] => {
	const problems: string[] = [];
	const terms = new Set(
		[...context.matchAll(/^\*\*(.+?)\*\*:/gm)].map((m) =>
			(m[1] ?? "").toLowerCase(),
		),
	);
	const termCheck = (name: string) => {
		const message = `CONTEXT.md: add a **${termOf(name)}**: term for ${name}`;
		if (!terms.has(termOf(name).toLowerCase()) && !problems.includes(message))
			problems.push(message);
	};
	const byDomain = new Map<string, string[]>();
	for (const path of paths) {
		const [, , name, ...rest] = path.split("/");
		if (name)
			byDomain.set(name, [...(byDomain.get(name) ?? []), rest.join("/")]);
	}
	for (const [name, files] of byDomain) {
		const base = `src/domains/${name}`;
		const allowed = new Set(["index.ts", "ports.ts", `${name}-errors.ts`]);
		const folders = ["models", "use-cases", "rules", "api", "spi"];
		termCheck(name);
		for (const file of ["index.ts", "ports.ts"]) {
			if (!files.includes(file)) problems.push(`${base}/${file}: add ${file}`);
		}
		for (const folder of ["models", "use-cases"]) {
			if (!files.some((f) => f.startsWith(`${folder}/`)))
				problems.push(
					`${base}/${folder}/: add at least one file in ${folder}/`,
				);
		}
		for (const folder of ["api", "spi"]) {
			if (
				files.some((f) => f.startsWith(`${folder}/`)) &&
				!files.includes(`${folder}/index.ts`)
			) {
				problems.push(`${base}/${folder}/index.ts: add index.ts to ${folder}/`);
			}
		}
		for (const file of files) {
			const top = file.split("/")[0] ?? "";
			if (!allowed.has(file) && !folders.includes(top)) {
				problems.push(
					`${base}/${file}: a domain root holds only index.ts, ports.ts and ${name}-errors.ts; put models in models/, rules in rules/, use cases in use-cases/, inbound adapters in api/, outbound adapters in spi/`,
				);
			}
		}
		for (const file of files) {
			const match = /^models\/([^/]+)\.ts$/.exec(file);
			if (match?.[1] && !match[1].endsWith(".test")) termCheck(match[1]);
		}
	}
	return problems;
};

const filesList = (dir: URL, prefix: string) =>
	readdirSync(dir, { encoding: "utf8", recursive: true })
		// Dotfiles (.DS_Store) are the OS's, not the project's.
		.filter((name) => !/(^|\/)\./.test(name))
		.filter((name) => statSync(new URL(name, dir)).isFile())
		.map((name) => `${prefix}/${name}`);

const context = "**Bar**:\nA thing.\n";
const barBase = [
	"src/domains/bar/index.ts",
	"src/domains/bar/ports.ts",
	"src/domains/bar/models/bar.ts",
	"src/domains/bar/use-cases/bar-create.ts",
];
const without = (path: string) => barBase.filter((p) => p !== path);

describe("domain structure", () => {
	it("holds for the real tree", () => {
		const domains = new URL("src/domains/", appRoot);
		const paths = filesList(domains, "src/domains");
		const text = readFileSync(new URL("CONTEXT.md", appRoot), "utf8");
		// A rendered project starts with no domain, so only the folder must exist.
		expect(existsSync(domains)).toBe(true);
		expect(structureViolations(paths, text)).toEqual([]);
	});

	it("passes a complete domain", () => {
		expect(
			structureViolations(
				[...barBase, "src/domains/bar/api/index.ts"],
				context,
			),
		).toEqual([]);
	});

	it.each([
		[
			"missing ports.ts",
			without("src/domains/bar/ports.ts"),
			"src/domains/bar/ports.ts: add ports.ts",
		],
		[
			"missing use-cases/",
			without("src/domains/bar/use-cases/bar-create.ts"),
			"src/domains/bar/use-cases/: add at least one file in use-cases/",
		],
		[
			"api/ without index.ts",
			[...barBase, "src/domains/bar/api/bar-routes.ts"],
			"src/domains/bar/api/index.ts: add index.ts to api/",
		],
		[
			"a stray root file",
			[...barBase, "src/domains/bar/helper.ts"],
			"src/domains/bar/helper.ts: a domain root holds only index.ts, ports.ts and bar-errors.ts",
		],
		[
			"a stray root folder",
			[...barBase, "src/domains/bar/helpers/x.ts"],
			"src/domains/bar/helpers/x.ts: a domain root holds only",
		],
		[
			"a model with no glossary term",
			[...barBase, "src/domains/bar/models/bar-line.ts"],
			"CONTEXT.md: add a **Bar line**: term for bar-line",
		],
	])("fails on %s", (_name, paths, message) => {
		expect(structureViolations(paths, context)).toEqual([
			expect.stringContaining(message),
		]);
	});

	it("fails on a domain with no glossary term", () => {
		expect(structureViolations(barBase, "**Baz**:\n")).toEqual([
			"CONTEXT.md: add a **Bar**: term for bar",
		]);
	});

	it("passes a model once the glossary has its term", () => {
		const paths = [...barBase, "src/domains/bar/models/bar-line.ts"];
		expect(structureViolations(paths, `${context}**Bar line**:\n`)).toEqual([]);
	});
});
