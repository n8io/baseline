import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A Package's public API names no vendor (docs/adr/0005-vendor-escape-hatch.md), so a Project can
// change vendor without changing callers. This test reads what `src/index.ts` of the Packages in
// `packagesChecked` exports, on every subpath of the Package, and fails when an exported signature
// names a type imported from the vendor's module (`pg`, `pg-boss`, `redis`, `@sentry/*`, `@launchdarkly/*`,
// `@openfeature/*`, `mixpanel`), or when an index exports a `*VendorOptions` type: the `vendor`
// option's type stays inside the Package, and a Project writes the object inline in its `*-open.ts`
// or `connections.ts`.
const repoRoot = fileURLToPath(new URL("../", import.meta.url));

const packagesChecked = [
	"analytics",
	"error-tracking",
	"feature-flags",
	"postgres",
	"queue",
	"redis",
] as const;
const vendorModule =
	/^(?:pg|pg-boss|redis|mixpanel|@redis\/.+|@sentry\/.+|@launchdarkly\/.+|@openfeature\/.+)$/;

// Exports that still name a vendor, each with the reason and the change that removes it. The test
// fails on a new one, and on an entry that no longer names a vendor, so the list only shrinks.
const knownLeaks: Readonly<Record<string, string>> = {};

const blank = (text: string) => text.replace(/[^\n]/g, " ");

// Comments and strings blanked, offsets kept.
const codeOf = (source: string) =>
	source.replace(
		/\/\*[\s\S]*?\*\/|\/\/.*$|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\[\s\S]|[^`\\])*`/gm,
		blank,
	);

// The names a file imports from a vendor module, read before strings are blanked.
const vendorNamesOf = (source: string): string[] =>
	[...source.matchAll(/^import\s+([^;]+?)\s+from\s+"([^"]+)";/gms)]
		.filter((m) => vendorModule.test(m[2] ?? ""))
		.flatMap((m) =>
			(m[1] ?? "")
				.replace(/\btype\s+/g, "")
				.replace(/[{}*]/g, ",")
				.split(",")
				.map(
					(part) =>
						part
							.trim()
							.split(/\s+as\s+/)
							.pop() ?? "",
				)
				.filter(Boolean),
		);

// The exported names of an index: `export { type A, b } from "./x.ts"`, with the file each is from.
const indexExportsOf = (source: string): { file: string; name: string }[] =>
	[
		...source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*"([^"]+)"/g),
	].flatMap((m) =>
		(m[1] ?? "")
			.split(",")
			.map((part) =>
				part
					.trim()
					.replace(/^type\s+/, "")
					.split(/\s+as\s+/)
					.pop(),
			)
			.filter((name): name is string => Boolean(name))
			.map((name) => ({ file: m[2] ?? "", name })),
	);

// Each subpath entry of a Package: `src/index.ts`, `src/launchdarkly/index.ts`, and so on, read from
// the `exports` map. An entry that only re-exports another entry's names is read too, and resolves
// each name against the entry's own directory.
const entriesOf = (pkg: string): string[] => {
	const packageJson = JSON.parse(
		readFileSync(path.join(repoRoot, "packages", pkg, "package.json"), "utf8"),
	) as { exports: Record<string, string> };
	return Object.values(packageJson.exports).filter((file) =>
		file.endsWith("index.ts"),
	);
};

// The signature of one exported declaration: a type in full, a const or function up to its body.
const signatureOf = (source: string, name: string): string | null => {
	const code = codeOf(source);
	const found = new RegExp(
		`^export\\s+(?:async\\s+)?(type|const|function|interface)\\s+${name}\\b`,
		"m",
	).exec(code);
	if (!found) {
		return null;
	}
	const rest = code.slice(found.index);
	if (found[1] === "type" || found[1] === "interface") {
		const end = rest.search(/\n(?=\S)/);
		return end === -1 ? rest : rest.slice(0, end);
	}
	const end = rest.search(/=>|\)\s*(?::[^{]*)?\{/);
	return end === -1 ? rest : rest.slice(0, end);
};

// What a signature names from the vendor: the vendor's imports, directly or through a type of the
// same file that is not exported (the `vendor` option's type is the one allowed, see above).
const leaksOf = (source: string, name: string): string[] => {
	const signature = signatureOf(source, name);
	if (signature === null) {
		return [];
	}
	const vendorNames = vendorNamesOf(source);
	const word = (n: string) => new RegExp(`\\b${n}\\b`);
	return vendorNames.filter((n) => word(n).test(signature));
};

const exportsLeaking = (): { key: string; names: string[] }[] =>
	packagesChecked.flatMap((pkg) =>
		entriesOf(pkg).flatMap((entry) => {
			const entryPath = path.join(repoRoot, "packages", pkg, entry);
			return indexExportsOf(readFileSync(entryPath, "utf8")).flatMap(
				({ file, name }) => {
					const source = readFileSync(
						path.join(path.dirname(entryPath), file),
						"utf8",
					);
					const names = leaksOf(source, name);
					return names.length > 0 ? [{ key: `${pkg}:${name}`, names }] : [];
				},
			);
		}),
	);

describe("vendor-neutral public types", () => {
	it("finds a vendor name in an exported signature", () => {
		const source = [
			'import pg from "pg";',
			'import { type RedisClientType, createClient } from "redis";',
			"export type A = pg.Pool & AsyncDisposable;",
			"export type B = RedisClientType;",
			"export type C = { close(): Promise<void> };",
			"export const d = (p: pg.Pool): number => 1;",
			'// export type E = pg.Pool; "RedisClientType"',
		].join("\n");
		expect(leaksOf(source, "A")).toEqual(["pg"]);
		expect(leaksOf(source, "B")).toEqual(["RedisClientType"]);
		expect(leaksOf(source, "C")).toEqual([]);
		expect(leaksOf(source, "d")).toEqual(["pg"]);
		expect(leaksOf(source, "E")).toEqual([]);
	});

	it("reads an `export type { }` list as well", () => {
		expect(indexExportsOf('export type { A, B } from "./x.ts";')).toEqual([
			{ file: "./x.ts", name: "A" },
			{ file: "./x.ts", name: "B" },
		]);
	});

	it("reads the names a Package index exports", () => {
		expect(
			indexExportsOf(
				'export {\n\ttype A,\n\tb as c,\n} from "./x.ts";\nexport { d } from "./y.ts";',
			),
		).toEqual([
			{ file: "./x.ts", name: "A" },
			{ file: "./x.ts", name: "c" },
			{ file: "./y.ts", name: "d" },
		]);
	});

	it("exports no signature that names a vendor's type, beyond the known leaks", () => {
		const found = exportsLeaking().map(({ key }) => key);
		expect(found.filter((key) => !(key in knownLeaks))).toEqual([]);
		// A leak that was fixed leaves the list.
		expect(
			Object.keys(knownLeaks).filter((key) => !found.includes(key)),
		).toEqual([]);
	});

	it("keeps each vendor option's type out of the Package index", () => {
		const exported = packagesChecked.flatMap((pkg) =>
			entriesOf(pkg).flatMap((entry) =>
				indexExportsOf(
					readFileSync(path.join(repoRoot, "packages", pkg, entry), "utf8"),
				)
					.filter(({ name }) => name.endsWith("VendorOptions"))
					.map(({ name }) => `${pkg}:${name}`),
			),
		);
		expect(exported).toEqual([]);
	});
});
