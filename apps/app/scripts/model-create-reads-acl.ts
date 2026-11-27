// The ACL a context reads an upstream through, as --reads writes it: its port, its adapter, its
// test and the upstream's test build, all in foo's names before the rename.
import { camelFromKebab, pascalFromKebab } from "./template-render.ts";

export type Target = {
	camel: string;
	kebab: string;
	pascal: string;
	snake: string;
	words: string;
};

export const targetNames = (kebab: string): Target => ({
	camel: camelFromKebab(kebab),
	kebab,
	pascal: pascalFromKebab(kebab),
	snake: kebab.replaceAll("-", "_"),
	words: kebab.replaceAll("-", " "),
});

const article = (words: string): string =>
	/^[aeiou]/.test(words) ? `an ${words}` : `a ${words}`;

export const aclPort = (t: Target): string[] => [
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

export const aclTest = (t: Target): string =>
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

export const upstreamTest = (targets: Target[]): string =>
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
