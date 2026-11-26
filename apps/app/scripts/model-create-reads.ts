import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { kebabPattern } from "./model-create-foo.ts";
import { importEnd } from "./model-create-wiring.ts";
import {
	camelFromKebab,
	lineIsFoo,
	type NameForms,
	pascalFromKebab,
	type TemplateFile,
} from "./template-render.ts";

// --reads: an anti-corruption layer (ACL) per upstream context, written in foo's names before the
// rename. The ACL belongs to the context, so context-create writes it; model-create passes the
// context's upstream to the ports calls in the Model's tests.

type Target = {
	camel: string;
	kebab: string;
	pascal: string;
	snake: string;
	words: string;
};

const targetNames = (kebab: string): Target => ({
	camel: camelFromKebab(kebab),
	kebab,
	pascal: pascalFromKebab(kebab),
	snake: kebab.replaceAll("-", "_"),
	words: kebab.replaceAll("-", " "),
});

const article = (words: string): string =>
	/^[aeiou]/.test(words) ? `an ${words}` : `a ${words}`;

// The ACL a context reads an upstream through: src/contexts/<context>/adapters/outbound/<context>-<upstream>-acl.ts.
export const aclPath = ({
	context,
	upstream,
}: {
	context: string;
	upstream: string;
}): string =>
	`src/contexts/${context}/adapters/outbound/${context}-${upstream}-acl.ts`;

// The reason a --reads target is refused, or undefined when it is fine.
export const readsRefusal = ({
	appDirectory,
	names,
	reads,
}: {
	appDirectory: string;
	names: NameForms;
	reads: string[];
}): string | undefined => {
	for (const kebab of reads) {
		if (!kebabPattern.test(kebab))
			return `--reads "${kebab}" is not kebab-case`;
		if (kebab === names.kebab) return `${kebab} cannot read itself`;
		// The Template's own context is renamed with the copy, so it cannot be a target.
		if (lineIsFoo(kebab))
			return `--reads ${kebab}: names foo, the Template's example name, which the render renames`;
		if (!existsSync(join(appDirectory, "src/contexts", kebab, "index.ts")))
			return `--reads ${kebab}: no src/contexts/${kebab}/`;
		if (
			existsSync(
				join(appDirectory, aclPath({ context: kebab, upstream: names.kebab })),
			)
		) {
			return `--reads ${kebab}: ${kebab} already reads ${names.kebab}; two contexts never read each other, so one reacts to the other's Domain events`;
		}
	}
	if (new Set(reads).size !== reads.length)
		return "--reads names a context twice";
	return undefined;
};

// Inserts before the anchor line, after it, or above the comment block that leads into it, so an
// anchor is code or a `// wiring:` marker and rewording a prose comment breaks nothing.
const linesAt = ({
	anchor,
	lines,
	path,
	text,
	where = "before",
}: {
	anchor: string;
	lines: string[];
	path: string;
	text: string;
	where?: "after" | "before" | "aboveComment";
}): string => {
	const all = text.split("\n");
	const found = all.indexOf(anchor);
	if (found === -1 || all.indexOf(anchor, found + 1) !== -1) {
		throw new Error(`${path}: --reads needs exactly one line "${anchor}"`);
	}
	let at = where === "after" ? found + 1 : found;
	while (where === "aboveComment" && /^\s*\/\//.test(all[at - 1] ?? "")) at--;
	all.splice(at, 0, ...lines);
	return all.join("\n");
};

const importsAfter = (text: string, imports: string[]): string => {
	const lines = text.split("\n");
	lines.splice(importEnd(lines) + 1, 0, ...imports);
	return lines.join("\n");
};

// The calls that build foo's ports or foo itself, which a context that reads needs its upstream
// for: fooPortsMemoryCreate() gets it as its argument, fooPortsCreate(connections) as its second,
// and fooContextCreate({ connections }) as a field.
const upstreamCallsExtend = (text: string): string => {
	let out = text;
	for (const call of [
		"fooPortsMemoryCreate(",
		"fooPortsCreate(",
		"fooContextCreate(",
	]) {
		let next = "";
		let from = 0;
		for (let at = out.indexOf(call); at !== -1; at = out.indexOf(call, from)) {
			// A call a comment names is no call.
			const lineStart = out.lastIndexOf("\n", at) + 1;
			if (out.slice(lineStart, at).trimStart().startsWith("//")) {
				next += out.slice(from, at + call.length);
				from = at + call.length;
				continue;
			}
			let depth = 1;
			let k = at + call.length;
			while (depth > 0 && k < out.length) {
				if (out[k] === "(") depth++;
				if (out[k] === ")") depth--;
				k++;
			}
			const inside = out.slice(at + call.length, k - 1).replace(/,\s*$/, "");
			const extended =
				call === "fooContextCreate("
					? inside.replace(/,?\s*\}\s*$/, ", upstream }")
					: inside.trim() === ""
						? "upstream"
						: `${inside}, upstream`;
			next += `${out.slice(from, at)}${call}${extended})`;
			from = k;
		}
		out = next + out.slice(from);
	}
	return out;
};

// A test that builds foo's ports or foo itself builds foo's upstream once, for real on memory.
// The file shares it: Foo's tests never write upstream rows, and a test that does builds its own.
const upstreamTestBuild = ({
	path,
	text,
}: {
	path: string;
	text: string;
}): string => {
	const helper = relative(
		dirname(path),
		"src/contexts/foo/adapters/outbound/foo-test-upstream.ts",
	);
	const specifier = helper.startsWith(".") ? helper : `./${helper}`;
	return linesAt({
		text: importsAfter(upstreamCallsExtend(text), [
			`import { fooTestUpstreamCreate } from "${specifier}";`,
		]),
		path,
		where: "after",
		anchor: `import { fooTestUpstreamCreate } from "${specifier}";`,
		lines: [
			"",
			"// The contexts this context reads, built for real on memory adapters.",
			"const upstream = await fooTestUpstreamCreate();",
		],
	});
};

const aclPort = (t: Target): string[] => [
	`// What the context reads about ${article(t.words)}, in its own terms: the anti-corruption layer in`,
	`// adapters/outbound/foo-${t.kebab}-acl.ts fills it from the ${t.words} context.`,
	`export type Foo${t.pascal}Acl = {`,
	`\tget(id: Id<"${t.snake}">): Promise<{ name: string } | undefined>;`,
	"};",
	"",
];

export const acl = (t: Target): string =>
	`import type { Actor } from "@n8io/baseline-authn";
import type { ${t.pascal}Context } from "#contexts/${t.kebab}/index.ts";
import type { Foo${t.pascal}Acl } from "../../application/ports.ts";

// What the ACL uses of the ${t.words} context's interface.
export type Foo${t.pascal}Upstream = Pick<${t.pascal}Context, "useCases">;

// The ACL's own machine Actor: it only reads, so it holds no scope.
const foo${t.pascal}AclActor: Actor = {
	id: "foo-${t.kebab}-acl",
	kind: "client",
	scopes: [],
};

// Reads ${article(t.words)} through ${t.camel}Get and keeps only what foo needs of it.
export const foo${t.pascal}AclCreate = ({
	useCases,
}: Foo${t.pascal}Upstream): Foo${t.pascal}Acl => ({
	get: async (id) => {
		const r = await useCases.${t.camel}Get(foo${t.pascal}AclActor, {
			${t.camel}Id: id,
		});
		return r.ok ? { name: r.value.name } : undefined;
	},
});
`;

const aclTest = (t: Target): string =>
	`import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { describe, expect, it } from "vitest";
import { foo${t.pascal}AclCreate } from "./foo-${t.kebab}-acl.ts";
import { fooTestUpstreamCreate } from "./foo-test-upstream.ts";

const owner: Actor = { id: "owner", kind: "user", scopes: [] };

describe("foo${t.pascal}AclCreate", () => {
	it("reads ${article(t.words)}'s name through ${t.camel}Get", async () => {
		const { ${t.camel} } = await fooTestUpstreamCreate();
		const created = await ${t.camel}.useCases.${t.camel}Create(owner, { name: "Acme" });
		if (!created.ok) throw created.error;

		const acl = foo${t.pascal}AclCreate(${t.camel});

		expect(await acl.get(created.value.id)).toEqual({ name: "Acme" });
	});

	it("answers undefined for ${article(t.words)} that does not exist", async () => {
		const acl = foo${t.pascal}AclCreate((await fooTestUpstreamCreate()).${t.camel});

		expect(await acl.get(idCreate("${t.snake}"))).toBeUndefined();
	});
});
`;

const upstreamTest = (targets: Target[]): string =>
	`import { connectionsOpen } from "../../../../connections.ts";
import { contextsCreate } from "../../../../contexts.ts";
import type { FooUpstream } from "./index.ts";

// The contexts this context reads, built for real on memory adapters, for tests: no fake
// stands in for an upstream. Each call builds them afresh, with nothing in them.
export const fooTestUpstreamCreate = async (): Promise<FooUpstream> => {
	const contexts = contextsCreate(
		await connectionsOpen({
			role: "publisher",
			urls: { cache: "memory://", database: "memory://" },
		}),
	);
	return { ${targets.map((t) => `${t.camel}: contexts.${t.camel}Context`).join(", ")} };
};
`;

// Foo's files, and src/contexts.ts, as a foo that reads each target would have them: still in
// foo's names, so the rename that follows spells them for the new context.
export const readsApply = ({
	files,
	reads,
}: {
	files: TemplateFile[];
	reads: string[];
}): TemplateFile[] => {
	const targets = reads.map(targetNames);
	if (targets.length === 0) return files;
	const field = (t: Target) => `foo${t.pascal}Acl`;
	const changed = files.map(({ path, text }): TemplateFile => {
		switch (path) {
			case "src/contexts/foo/application/ports.ts": {
				const withTypes = linesAt({
					text,
					path,
					anchor: "export type FooPorts = {",
					lines: targets.flatMap(aclPort),
				});
				return {
					path,
					text: linesAt({
						text: withTypes,
						path,
						anchor: "\t// wiring: ports",
						where: "after",
						lines: targets.map((t) => `\t${field(t)}: Foo${t.pascal}Acl;`),
					}),
				};
			}
			case "src/contexts/foo/adapters/outbound/index.ts": {
				const typed = text
					.replace(
						"(connections: Connections): FooPorts =>",
						"(\n\tconnections: Connections,\n\tupstream: FooUpstream,\n): FooPorts =>",
					)
					.replace(
						"fooPortsMemoryCreate().ports",
						"fooPortsMemoryCreate(upstream).ports",
					);
				if (
					!typed.includes("upstream: FooUpstream") ||
					!typed.includes("fooPortsMemoryCreate(upstream).ports")
				) {
					throw new Error(
						`${path}: --reads cannot find fooPortsCreate's signature`,
					);
				}
				const imported = importsAfter(
					typed,
					targets.map(
						(t) =>
							`import { type Foo${t.pascal}Upstream, foo${t.pascal}AclCreate } from "./foo-${t.kebab}-acl.ts";`,
					),
				);
				const declared = linesAt({
					text: imported,
					path,
					anchor: "export const fooPortsCreate = (",
					where: "aboveComment",
					lines: [
						"// The contexts this context reads, built before it in src/contexts.ts: each fills its ACL.",
						`export type FooUpstream = { ${targets.map((t) => `${t.camel}: Foo${t.pascal}Upstream`).join("; ")} };`,
						"",
					],
				});
				return {
					path,
					text: linesAt({
						text: declared,
						path,
						anchor: "\t\t// wiring: ports",
						lines: targets.map(
							(t) =>
								`\t\t${field(t)}: foo${t.pascal}AclCreate(upstream.${t.camel}),`,
						),
					}),
				};
			}
			case "src/contexts/foo/adapters/outbound/foo-ports.memory.ts": {
				const taken = text.replace(
					"export const fooPortsMemoryCreate = () => {",
					"export const fooPortsMemoryCreate = (upstream: FooUpstream) => {",
				);
				if (taken === text) {
					throw new Error(
						`${path}: --reads cannot find the parameters of fooPortsMemoryCreate`,
					);
				}
				return {
					path,
					text: linesAt({
						text: importsAfter(taken, [
							'import type { FooUpstream } from "./index.ts";',
							...targets.map(
								(t) =>
									`import { foo${t.pascal}AclCreate } from "./foo-${t.kebab}-acl.ts";`,
							),
						]),
						path,
						anchor: "\t\t// wiring: ports",
						lines: targets.map(
							(t) =>
								`\t\t${field(t)}: foo${t.pascal}AclCreate(upstream.${t.camel}),`,
						),
					}),
				};
			}
			case "src/contexts/foo/index.ts": {
				const upstreamTaken = text
					.replace(
						"({\n\tconnections,\n}: {\n\tconnections: Connections;\n})",
						"({\n\tconnections,\n\tupstream,\n}: {\n\tconnections: Connections;\n\t// The contexts it reads, built before it: src/contexts.ts passes them.\n\tupstream: FooUpstream;\n})",
					)
					.replace(
						"fooPortsCreate(connections)",
						"fooPortsCreate(connections, upstream)",
					);
				if (!upstreamTaken.includes("upstream: FooUpstream")) {
					throw new Error(
						`${path}: --reads cannot find the parameters of fooContextCreate`,
					);
				}
				const imported = upstreamTaken.replace(
					'import { fooPortsCreate } from "./adapters/outbound/index.ts";',
					'import {\n\ttype FooUpstream,\n\tfooPortsCreate,\n} from "./adapters/outbound/index.ts";',
				);
				if (imported === upstreamTaken) {
					throw new Error(
						`${path}: --reads cannot find the import of fooPortsCreate`,
					);
				}
				return { path, text: imported };
			}
			case "src/contexts.ts": {
				const wired = text.replace(
					"fooContextCreate({ connections })",
					`fooContextCreate({\n\tconnections,\n\tupstream: { ${targets
						.map(
							(t) =>
								`// Built after ${t.words}: it reads ${t.words} through an ACL.\n${t.camel}: ${t.camel}Context`,
						)
						.join(",\n")} },\n})`,
				);
				if (wired === text) {
					throw new Error(
						`${path}: --reads cannot find the fooContextCreate({ connections }) call`,
					);
				}
				return { path, text: wired };
			}
			default:
				return path.endsWith(".test.ts") &&
					/\bfoo(PortsMemoryCreate|PortsCreate|ContextCreate)\(/.test(text)
					? { path, text: upstreamTestBuild({ path, text }) }
					: { path, text };
		}
	});
	return [
		...changed,
		{
			path: "src/contexts/foo/adapters/outbound/foo-test-upstream.ts",
			text: upstreamTest(targets),
		},
		...targets.flatMap((t) => [
			{
				path: `src/contexts/foo/adapters/outbound/foo-${t.kebab}-acl.ts`,
				text: acl(t),
			},
			{
				path: `src/contexts/foo/adapters/outbound/foo-${t.kebab}-acl.test.ts`,
				text: aclTest(t),
			},
		]),
	];
};
