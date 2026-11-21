import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A Package's public types promise callers that the Package never edits what they pass in and
// that they cannot edit what it hands back, so an exported signature uses readonly arrays and
// ReadonlyMap/ReadonlySet, never `T[]`, `Array<T>`, `Map<K, V>` or `Set<T>`. A signature that must
// stay mutable (a third-party type it forwards) says why in a `// mutable: <why>` comment on the
// line above the export or the property.
const repoRoot = fileURLToPath(new URL("../", import.meta.url));

const blank = (text: string) => text.replace(/[^\n]/g, " ");

// Strings first, then comments, keeping offsets, so neither hides code from the other.
const codeOf = (source: string) => {
	const noStrings = source.replace(
		/\/\*[\s\S]*?\*\/|\/\/.*$|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\[\s\S]|[^`\\])*`/gm,
		(c) => (c.startsWith("/") ? c : blank(c)),
	);
	return noStrings.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, blank);
};

// `readonly` then an element type (a name, a generic, a parenthesized union, an object type or a
// tuple) then one or more `[]`, or a readonly tuple whose rest element is an array.
const readonlyArrayPattern =
	/\breadonly\s+(?:\([^()]*\)|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}|[\w.]+(?:<[^<>]*(?:<[^<>]*>)?[^<>]*>)?)(?:\[\])+|\breadonly\s+\[(?:[^[\]]|\[\])*\]/g;
const mutablePattern =
	/\[\]|\bArray\s*<|\bMap\s*<|\bSet\s*<|\bRecord\s*<[^>]*\[\]/g;

// The text of each exported declaration that other code sees: a type or interface in full, a
// function or const up to the start of its body.
const signaturesOf = (code: string) =>
	[
		...code.matchAll(
			/^export\s+(?:declare\s+)?(?:async\s+)?(?:default\s+)?(type|interface|const|function|class)\b/gm,
		),
	].map((m) => {
		const start = m.index ?? 0;
		const rest = code.slice(start);
		const kind = m[1];
		if (kind === "type" || kind === "interface") {
			const end = rest.search(/\n(?=\S)/);
			return { start, text: end === -1 ? rest : rest.slice(0, end) };
		}
		let depth = 0;
		let arrow = false;
		let inType = 0;
		for (let i = 0; i < rest.length; i++) {
			const c = rest[i] ?? "";
			const next = rest[i + 1];
			if ("([<".includes(c) && !(c === "<" && rest[i - 1] === "=")) {
				depth += 1;
			} else if (")]>".includes(c) && rest[i - 1] !== "=") {
				depth -= 1;
			} else if (depth <= 0 && c === "=" && next === ">") {
				return { start, text: rest.slice(0, i) };
			} else if (depth <= 0 && kind === "const" && c === "=" && !arrow) {
				// The value after `=` is only a signature when it is a function.
				if (!/^=\s*(?:async\s*)?[(<]/.test(rest.slice(i))) {
					return { start, text: rest.slice(0, i) };
				}
				arrow = true;
			} else if (depth <= 0 && c === "{" && kind !== "const") {
				// A `{` after `:`, `|` or `&` opens an object type in the return type, not the body.
				if (/[:|&]\s*$/.test(rest.slice(0, i))) {
					depth += 1;
					inType += 1;
					continue;
				}
				return { start, text: rest.slice(0, i) };
			} else if (c === "}" && inType > 0) {
				depth -= 1;
				inType -= 1;
			}
		}
		return { start, text: rest.slice(0, 400) };
	});

const mutableTypesFind = (file: string, source: string): string[] => {
	const code = codeOf(source);
	const lines = source.split("\n");
	return signaturesOf(code).flatMap(({ start, text }) => {
		const first = text
			.replace(/=\s*\[\]/g, blank)
			.replace(readonlyArrayPattern, blank)
			.matchAll(mutablePattern)
			.next().value;
		if (!first) {
			return [];
		}
		const line = code.slice(0, start).split("\n").length;
		const hitLine = line + text.slice(0, first.index).split("\n").length - 1;
		const why = /^\s*\/\/ mutable: \S+(\s+\S+){2,}\s*$/;
		if ([line, hitLine].some((n) => why.test(lines[n - 2] ?? ""))) {
			return [];
		}
		return [
			`${file}:${hitLine}: ${first[0].trim()} in an exported signature; use readonly T[], ReadonlyMap or ReadonlySet`,
		];
	});
};

const sourcesRead = () =>
	readdirSync(path.join(repoRoot, "packages"), { recursive: true })
		.map((name) => `packages/${String(name).split(path.sep).join("/")}`)
		.filter(
			(name) =>
				/\/src\/.*\.ts$/.test(name) &&
				!/\.(test|contract)\.ts$/.test(name) &&
				!name.endsWith(".d.ts") &&
				!/(^|\/)(node_modules|dist)\//.test(name),
		)
		.map((name) => ({
			name,
			source: readFileSync(path.join(repoRoot, name), "utf8"),
		}));

describe("readonly public types", () => {
	it("flags a mutable array, Map or Set in an exported signature", () => {
		const find = (source: string) => mutableTypesFind("x.ts", source);
		expect(find("export type A = { ids: string[] };")).toHaveLength(1);
		expect(
			find("export const f = (ids: Array<string>): void => {};"),
		).toHaveLength(1);
		expect(
			find("export function f(m: Map<string, number>) {\n\treturn m;\n}"),
		).toHaveLength(1);
		expect(find("export const f = (): Set<string> => new Set();")).toHaveLength(
			1,
		);
		expect(
			find(
				"export type A = { ids: readonly string[]; n: readonly (A | B)[] };",
			),
		).toEqual([]);
		expect(
			find(
				"export const f = (ids: readonly string[]): ReadonlyMap<string, number> => {\n\tconst local: string[] = [];\n\treturn new Map(local);\n};",
			),
		).toEqual([]);
		expect(
			find("export function f(): { a: string[] } {\n\treturn { a: [] };\n}"),
		).toHaveLength(1);
		expect(find("export const f = (a: readonly string[] = []) => a;")).toEqual(
			[],
		);
		expect(find("const local = (ids: string[]) => ids;")).toEqual([]);
		expect(
			find(
				"// mutable: forwarded to pg unchanged\nexport type A = { values: unknown[] };",
			),
		).toEqual([]);
	});

	it("has none in the exported signatures of packages/*/src", () => {
		const files = sourcesRead();
		expect(files.length).toBeGreaterThan(50);
		expect(files.flatMap((f) => mutableTypesFind(f.name, f.source))).toEqual(
			[],
		);
	});
});
