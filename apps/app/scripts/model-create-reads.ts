import { existsSync } from "node:fs";
import { join } from "node:path";
import { kebabPattern } from "./model-create-foo.ts";
import {
	acl,
	aclPort,
	aclTest,
	type Target,
	targetNames,
	upstreamTest,
} from "./model-create-reads-acl.ts";
import {
	importsAfter,
	linesAt,
	upstreamTestBuild,
} from "./model-create-reads-edit.ts";
import {
	lineIsFoo,
	type NameForms,
	type TemplateFile,
} from "./template-render.ts";

// --reads: an anti-corruption layer (ACL) per upstream context, written in foo's names before the
// rename. The ACL belongs to the context, so context-create writes it; model-create passes the
// context's upstream to the ports calls in the Model's tests.

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
