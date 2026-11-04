import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type EnvItem = {
	decorators: string;
	// "" for a line that is not KEY=value; `line` then holds its text before "=" (never a value).
	key: string;
	line: string;
	value: string;
};
type EnvFiles = {
	development: string;
	production: string;
	schema: string;
	test: string;
};

// Quotes are stripped; an unquoted value ends at " #" (a trailing comment).
const envValue = (raw: string): string => {
	const value = raw.trim();
	const quoted = /^(["'])(.*)\1$/.exec(value);
	return quoted ? (quoted[2] ?? "") : (value.split(/\s+#/)[0] ?? "").trim();
};

const envFileParse = (text: string): EnvItem[] => {
	const items: EnvItem[] = [];
	let comments: string[] = [];
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (line === "# ---") comments = [];
		else if (line.startsWith("#")) comments.push(line);
		else if (line === "") comments = [];
		else {
			const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
			items.push({
				decorators: comments.join("\n"),
				key: match?.[1] ?? "",
				line: line.split("=")[0] ?? "",
				value: envValue(match?.[2] ?? ""),
			});
			comments = [];
		}
	}
	return items;
};

const envRequired = (
	decorators: string,
	env: string,
	defaultRequired: boolean,
): boolean => {
	if (/@optional\b|@required=false/.test(decorators)) return false;
	if (/@required(=true)?(\s|$)/.test(decorators)) return true;
	const list = /@required=forEnv\(([^)]*)\)/.exec(decorators);
	return list
		? (list[1] ?? "")
				.split(",")
				.map((name) => name.trim())
				.includes(env)
		: defaultRequired;
};

const envViolations = (files: EnvFiles): string[] => {
	const problems: string[] = [];
	for (const [name, text] of Object.entries(files)) {
		for (const item of envFileParse(text).filter((i) => i.key === "")) {
			problems.push(
				`.env.${name} has a line that is not KEY=value: ${item.line}`,
			);
		}
	}
	const schema = envFileParse(files.schema).filter((item) => item.key);
	const declared = new Set(schema.map((item) => item.key));
	const defaultRequired = !/@defaultRequired=false/.test(
		files.schema.split("# ---")[0] ?? "",
	);
	for (const env of ["development", "test"] as const) {
		const values = new Map(
			envFileParse(files[env]).map((item) => [item.key, item.value]),
		);
		for (const item of schema) {
			if (
				item.value === "" &&
				envRequired(item.decorators, env, defaultRequired) &&
				!values.get(item.key)
			) {
				problems.push(
					`.env.${env} needs a value for ${item.key} (.env.schema gives it no default)`,
				);
			}
		}
	}
	for (const item of envFileParse(files.production).filter((i) => i.key)) {
		if (!/^op\(op:\/\/[^)\s]+\)$/.test(item.value)) {
			problems.push(
				`.env.production sets ${item.key} to a value; use an op(op://<vault>/<item>/<field>) reference`,
			);
		}
	}
	for (const env of ["development", "test", "production"] as const) {
		for (const item of envFileParse(files[env])) {
			if (item.key && !declared.has(item.key))
				problems.push(
					`.env.${env} sets ${item.key}, which .env.schema does not declare`,
				);
		}
	}
	return problems;
};

const fileRead = (name: string) =>
	readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

const schema = [
	"# @defaultRequired=true",
	"# ---",
	"A_KEY=",
	"# @required=false",
	"B_KEY=",
	"# @required=forEnv(production)",
	"C_KEY=",
	"# @optional",
	"E_KEY=",
	"D_KEY=fixed",
].join("\n");
const good: EnvFiles = {
	development: "A_KEY=x",
	production: "A_KEY=op(op://vault/item/field)",
	schema,
	test: "A_KEY=y",
};

describe("env files", () => {
	it("pass against the real schema", () => {
		const files = {
			development: fileRead(".env.development"),
			production: fileRead(".env.production"),
			schema: fileRead(".env.schema"),
			test: fileRead(".env.test"),
		};
		expect(envViolations(files)).toEqual([]);
	});

	it("accept optional and production-only items missing from development and test", () => {
		expect(envViolations(good)).toEqual([]);
	});

	it.each([
		[
			"a required item missing from .env.test",
			{ test: "" },
			[".env.test needs a value for A_KEY (.env.schema gives it no default)"],
		],
		[
			"an empty value in .env.development",
			{ development: "A_KEY=" },
			[
				".env.development needs a value for A_KEY (.env.schema gives it no default)",
			],
		],
		[
			"a plain value in .env.production",
			{ production: "A_KEY=plain" },
			[
				".env.production sets A_KEY to a value; use an op(op://<vault>/<item>/<field>) reference",
			],
		],
		[
			"an empty quoted value",
			{ test: 'A_KEY=""' },
			[".env.test needs a value for A_KEY (.env.schema gives it no default)"],
		],
		[
			"a line that is not KEY=value",
			{ production: "export A_KEY=plain" },
			[".env.production has a line that is not KEY=value: export A_KEY"],
		],
		[
			"an undeclared key",
			{ test: "A_KEY=y\nZ_KEY=1" },
			[".env.test sets Z_KEY, which .env.schema does not declare"],
		],
	])("fail on %s", (_name, change, expected) => {
		expect(envViolations({ ...good, ...change })).toEqual(expected);
	});
});
