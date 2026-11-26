import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	type ArchitectureFile,
	architectureFileCreate,
	architectureFileNamesCheck,
	architectureRules,
	architectureSrcRead,
} from "./architecture-test-rules.ts";

// The files this test reads or runs from disk, so `pnpm test --changed` runs it when one changes.
import.meta.glob(["./src/**", "./architecture-test-samples/*.txt"], {
	query: "?raw",
});

const appRoot = fileURLToPath(new URL("./", import.meta.url));
const samplesDir = new URL("./architecture-test-samples/", import.meta.url);
const ruleIds = Object.keys(architectureRules);

const files = await architectureSrcRead(appRoot);

// A sample: `// A1: <rule>`, `// expect: <part of the message>`, then `// @file <path>` sections.
const samplesRead = () =>
	Promise.all(
		readdirSync(samplesDir)
			.filter((name) => name.endsWith(".txt"))
			.sort()
			.map(async (name) => {
				const text = readFileSync(new URL(name, samplesDir), "utf8");
				const rule = /^\/\/ (A\d+):/m.exec(text)?.[1] ?? "";
				const expected = /^\/\/ expect: (.+)$/m.exec(text)?.[1] ?? "";
				const sections = text.split(/^\/\/ @file (\S+)\n/m).slice(1);
				const sampleFiles: Promise<ArchitectureFile>[] = [];
				for (let i = 0; i < sections.length; i += 2) {
					sampleFiles.push(
						architectureFileCreate(sections[i] ?? "", sections[i + 1] ?? ""),
					);
				}
				return { expected, files: await Promise.all(sampleFiles), name, rule };
			}),
	);
const samples = await samplesRead();

describe("architecture", () => {
	it("reads every source file and its imports", () => {
		// Context-generic, so it holds after template-render removes foo.
		const server = files.find((f) => f.path === "src/server.ts");
		expect(files.length).toBeGreaterThan(10);
		expect(server?.imports.map((imp) => imp.target)).toContain("src/env.ts");
		// piece-start: ui
		const root = files.find((f) => f.path === "src/ui/root.tsx");
		expect(root?.imports.map((imp) => imp.specifier)).toContain("react-router");
		// piece-end: ui
	});

	it.each(ruleIds)("src/ keeps rule %s", (rule) => {
		expect(architectureRules[rule]?.(files)).toEqual([]);
	});

	it("has a failing sample for every rule", () => {
		expect([...new Set(samples.map((s) => s.rule))].sort()).toEqual(
			[...ruleIds].sort(),
		);
	});

	// The regex checks of A5, A11, A14, A18 and A28 pass once the failing file is fixed.
	it.each([
		{
			from: "#contexts/bar/adapters/inbound/bar-routes.ts",
			name: "a05-root-imports-adapter-entry.txt",
			to: "#contexts/bar/index.ts",
		},
		{
			from: "return { barContext };",
			name: "a18-context-unbuilt.txt",
			to: "const bazContext = bazContextCreate();\n\treturn { barContext, bazContext };",
		},
		{
			from: "useCases: barUseCasesCreate()",
			name: "a18-use-cases-unwrapped.txt",
			to: "useCases: telemetryUseCasesTrace(barUseCasesCreate())",
		},
		{
			from: "\tensure: (name: string) => useCases.bazCreate(actor, { name }),\n",
			name: "a11-acl-writes.txt",
			to: "",
		},
		{
			from: '"baz.created"',
			name: "a14-column-without-handler.txt",
			to: '"baz.deleted"',
		},
		{
			from: "=>\n\tports.billingTransaction(",
			name: "a28-transaction-two-models.txt",
			to: "=>\n\t// invariant: an invoice closes with its lines.\n\tports.billingTransaction(",
		},
		{
			from: "update({ ...invoice, name: input.name })",
			name: "a29-use-case-spreads-model.txt",
			to: "update(invoiceRename(invoice, input.name).value)",
		},
	])("$name passes once fixed", async ({ from, name, to }) => {
		const sample = samples.find((s) => s.name === name);
		const fixed = await Promise.all(
			(sample?.files ?? []).map((f) =>
				architectureFileCreate(f.path, f.source.replace(from, to)),
			),
		);
		expect(fixed.map((f) => f.source).join("")).not.toContain(from);
		expect(architectureRules[sample?.rule ?? ""]?.(fixed)).toEqual([]);
	});

	// The passing side of the flag rules: no flags file, no key written elsewhere, a typed read.
	it("A32 and A33 pass without flags, and for a typed read of a declared flag", async () => {
		const flags = await architectureFileCreate(
			"src/flags.ts",
			'import { featureFlagsDefine } from "@n8io/baseline-feature-flags";\nexport const flagDefs = featureFlagsDefine({ express: { key: "express-checkout", fallback: false } });\n',
		);
		const use = await architectureFileCreate(
			"src/contexts/bar/application/bar-checkout.ts",
			'import type { FeatureFlagsHandle } from "@n8io/baseline-feature-flags";\nexport const barExpress = async (h: FeatureFlagsHandle<never>) => (await h.get("express")) satisfies boolean;\nexport const barConst = h.get("express") as const;\n',
		);
		for (const rule of ["A32", "A33"]) {
			expect(architectureRules[rule]?.([])).toEqual([]);
			expect(architectureRules[rule]?.([flags, use])).toEqual([]);
		}
	});

	it("A35 passes without an entry.client and for one that reads the page", async () => {
		const entry = await architectureFileCreate(
			"src/ui/entry.client.tsx",
			"const tree = await featureFlagsBrowserStart({ page: document, tree: null });\n",
		);
		expect(architectureRules["A35"]?.([])).toEqual([]);
		expect(architectureRules["A35"]?.([entry])).toEqual([]);
	});

	// The passing side of each rule that A14 and A25 loosened or added.
	it("A6 lets an ACL import its upstream's index.ts, and a seed only the types of an upstream", async () => {
		const acl = await architectureFileCreate(
			"src/contexts/bar/adapters/outbound/bar-baz-acl.ts",
			'import type { BazContext } from "#contexts/baz/index.ts";\n',
		);
		const seed = (source: string) =>
			architectureFileCreate(
				"src/contexts/bar/adapters/inbound/bar-seed.ts",
				source,
			);
		const typed = await seed(
			'import type { BazContext } from "#contexts/baz/index.ts";\n',
		);
		expect(architectureRules["A6"]?.([acl, typed])).toEqual([]);
		// Without the ACL, baz is no upstream of bar.
		expect(architectureRules["A6"]?.([typed])).toHaveLength(1);
		const value = await seed(
			'import { bazScopes } from "#contexts/baz/index.ts";\n',
		);
		expect(architectureRules["A6"]?.([acl, value])).toHaveLength(1);
		const other = await architectureFileCreate(
			"src/contexts/bar/adapters/outbound/bar-baz-acl.ts",
			'import type { QuxContext } from "#contexts/qux/index.ts";\n',
		);
		expect(architectureRules["A6"]?.([other])).toHaveLength(1);
	});

	it("A6 lets only tests and test helpers in a context build contexts or open connections", async () => {
		const source =
			'import { connectionsOpen } from "../../../../connections.ts";\nimport { contextsCreate } from "../../../../contexts.ts";\n';
		const at = (path: string) => architectureFileCreate(path, source);
		const outbound = "src/contexts/bar/adapters/outbound";
		expect(
			architectureRules["A6"]?.([
				await at(`${outbound}/bar-test-upstream.ts`),
				await at(`${outbound}/bar-baz-acl.test.ts`),
			]),
		).toEqual([]);
		expect(
			architectureRules["A6"]?.([await at(`${outbound}/bar-baz-acl.ts`)]),
		).toHaveLength(2);
	});

	it("A11 reads a downstream's own call that starts with its upstream's name as its own", async () => {
		const acl = await architectureFileCreate(
			"src/contexts/baz-note/adapters/outbound/baz-note-baz-acl.ts",
			"export const bazNoteBazAclCreate = () => bazNoteShape(useCases.bazGet(actor, {}));\n",
		);
		expect(architectureRules["A11"]?.([acl])).toEqual([]);
	});

	it("A14 passes once the other context's deleted Event has an Event handler", async () => {
		const sample = samples.find(
			(s) => s.name === "a14-prefix-column-without-handler.txt",
		);
		expect(sample).toBeDefined();
		const handler = await architectureFileCreate(
			"src/contexts/trade/adapters/inbound/trade-team-deleted-handler.ts",
			'export const x = "team.deleted";\n',
		);
		expect(
			architectureRules["A14"]?.([...(sample?.files ?? []), handler]),
		).toEqual([]);
	});

	it("A14 needs no handler for an id of the context's own Model, and one for another context's Model", async () => {
		const own = await architectureFileCreate(
			"src/contexts/billing/adapters/outbound/invoice-line-table.ts",
			'import { pgSchema, text } from "drizzle-orm/pg-core";\nexport const t = pgSchema("billing").table("invoice_line", { invoiceId: text("invoice_id") });\n',
		);
		const invoice = await architectureFileCreate(
			"src/contexts/billing/adapters/outbound/invoice-table.ts",
			'import { pgSchema } from "drizzle-orm/pg-core";\nexport const t = pgSchema("billing").table("invoice", {});\n',
		);
		const shipping = await architectureFileCreate(
			"src/contexts/shipping/adapters/outbound/parcel-table.ts",
			'import { pgSchema, text } from "drizzle-orm/pg-core";\nexport const t = pgSchema("shipping").table("parcel", { invoiceId: text("invoice_id") });\n',
		);
		const models = await Promise.all(
			[
				"src/contexts/billing/domain/invoice.ts",
				"src/contexts/billing/domain/invoice-line.ts",
			].map((path) => architectureFileCreate(path, "")),
		);
		expect(architectureRules["A14"]?.([own, invoice, ...models])).toEqual([]);
		expect(
			architectureRules["A14"]?.([own, invoice, shipping, ...models]),
		).toEqual([
			'src/contexts/shipping/adapters/outbound/parcel-table.ts: a column holding a invoice id needs src/contexts/shipping/adapters/inbound/shipping-invoice-deleted-handler.ts handling "invoice.deleted", so rows never point at a deleted invoice',
		]);
		// A table with no domain/ file of its name is a projection, not a Model.
		expect(architectureRules["A14"]?.([own, invoice, shipping])).toEqual([]);
	});

	it("A14 reads the context's own longer Model name before another context's shorter one", async () => {
		const files = await Promise.all(
			[
				[
					"src/contexts/shop/adapters/outbound/shipment-table.ts",
					'import { pgSchema, text } from "drizzle-orm/pg-core";\nexport const t = pgSchema("shop").table("shipment", { orderItemId: text("order_item_id") });\n',
				],
				["src/contexts/shop/adapters/outbound/order-item-table.ts", ""],
				["src/contexts/shop/domain/order-item.ts", ""],
				["src/contexts/shop/domain/shipment.ts", ""],
				["src/contexts/catalog/adapters/outbound/item-table.ts", ""],
				["src/contexts/catalog/domain/item.ts", ""],
			].map(([path = "", source = ""]) => architectureFileCreate(path, source)),
		);
		expect(architectureRules["A14"]?.(files)).toEqual([]);
	});

	it.each([
		{
			body: "export const x = (ports) =>\n\tports.billingTransaction(async ({ invoiceRepository, invoiceLineRepository }) => ok());\n",
			found: 1,
			name: "destructured repositories",
		},
		{
			body: "// invariant: an invoice closes with its lines.\nconst a = 1;\nexport const x = (ports) =>\n\tports.billingTransaction(async (t) => t.invoiceRepository.x(t.invoiceLineRepository));\n",
			found: 1,
			name: "an invariant comment away from the call",
		},
		{
			body: "export const x = async (ports) => {\n\tawait ports.billingTransaction(async (t) => t.invoiceRepository.x());\n\tawait ports.billingTransaction(async (t) => t.invoiceLineRepository.x());\n};\n",
			found: 0,
			name: "one transaction per Model",
		},
		{
			body: "export const x = (ports) =>\n\t// invariant: an invoice closes with its lines,\n\t// which it locks first.\n\tports.billingTransaction(async (t) => t.invoiceRepository.x(t.invoiceLineRepository));\n",
			found: 0,
			name: "a two-line invariant comment above the call",
		},
	])("A28 finds $found with $name", async ({ body, found }) => {
		const file = await architectureFileCreate(
			"src/contexts/billing/application/invoice-close.ts",
			body,
		);
		expect(architectureRules["A28"]?.([file])).toHaveLength(found);
	});

	it.each([
		{
			body: "export const x = (a: { n: number }) => { a.n = 1; };\n",
			found: 1,
			name: "an assigned property",
		},
		{
			body: "export const x = (a: { n: number }) => { a.n += 1; a.n++; };\n",
			found: 2,
			name: "compound and update assignments",
		},
		{
			body: "export const x = (a: { n?: number }) => { delete a.n; };\n",
			found: 1,
			name: "a deleted property",
		},
		{
			body: "export const x = (a: { l: string[] }) => { a.l.push('x'); };\n",
			found: 1,
			name: "a push on a property",
		},
		{
			body: "export const x = (l: string[]) => l.sort();\n",
			found: 1,
			name: "a sort of the parameter",
		},
		{
			body: "export const x = (l: string[]) => l.splice(0, 1);\n",
			found: 1,
			name: "a splice",
		},
		{
			body: "export const x = (a: object) => Object.assign(a, { n: 1 });\n",
			found: 1,
			name: "Object.assign to the parameter",
		},
		{
			body: "export const x = ({ steps }: { steps: string[] }) => { steps.push('x'); };\n",
			found: 1,
			name: "a destructured parameter",
		},
		{
			body: "export const x = (a: { l: string[] }) => () => { a.l?.push('x'); };\n",
			found: 1,
			name: "a closure over a parameter",
		},
		{
			body: "export const x = (a: string[]) => { const b = [...a]; b.push('x'); return b.sort(); };\n",
			found: 0,
			name: "a local copy",
		},
		{
			body: "export const x = (l: string[]) => [...l].sort().reverse();\n",
			found: 0,
			name: "a copy sorted in the expression",
		},
		{
			body: "export const x = (l: string[]) => l.toSorted();\n",
			found: 0,
			name: "toSorted",
		},
		{
			body: "export const x = (m: Map<string, number>, s: Set<string>) => { m.set('a', 1); m.delete('a'); s.add('a'); };\n",
			found: 0,
			name: "Map and Set methods",
		},
		{
			body: "export const x = (a: string[]) => { const f = (b: string[]) => { b.push('x'); }; return f([...a]); };\n",
			found: 1,
			name: "an inner function's own parameter",
		},
		{
			body: "export const x = (a: string[]) => { const g = () => { const a: string[] = []; a.push('x'); return a; }; return g(); };\n",
			found: 0,
			name: "a local that reuses a parameter's name",
		},
		{
			body: "export const x = (a: { n: number }) => {\n\t// mutates: the caller wants the count in place\n\ta.n = 1;\n};\n",
			found: 0,
			name: "an explained mutation",
		},
		{
			body: "export const x = (a: { n: number }) => {\n\t// mutates: why\n\ta.n = 1;\n};\n",
			found: 1,
			name: "a one-word reason",
		},
		{
			body: "export const x = (a: { n: number }) => {\n\t// mutates: the caller wants the count in place\n\n\ta.n = 1;\n};\n",
			found: 1,
			name: "a comment that is not on the line above",
		},
	])("A30 finds $found with $name", async ({ body, found }) => {
		const file = await architectureFileCreate("src/bar-collect.ts", body);
		expect(architectureRules["A30"]?.([file])).toHaveLength(found);
	});

	it("A30 skips tests and generated files", async () => {
		const body = "export const x = (a: string[]) => a.push('x');\n";
		const files = await Promise.all([
			architectureFileCreate("src/bar-collect.test.ts", body),
			architectureFileCreate(
				"src/bar-generated.ts",
				`/**\n * Generated by \`pnpm sdk-generate\`. Do not edit.\n */\n${body}`,
			),
		]);
		expect(architectureRules["A30"]?.(files)).toEqual([]);
	});

	it("A23 lets a context's export start with one of its Models' names", async () => {
		const table = await architectureFileCreate(
			"src/contexts/billing/adapters/outbound/invoice-line-table.ts",
			"",
		);
		const model = await architectureFileCreate(
			"src/contexts/billing/domain/invoice-line.ts",
			"",
		);
		const useCase = await architectureFileCreate(
			"src/contexts/billing/application/invoice-line-create.ts",
			"export const invoiceLineCreate = () => 1;\nexport const noteCreate = () => 1;\n",
		);
		expect(architectureRules["A23"]?.([table, model, useCase])).toEqual([
			expect.stringContaining("noteCreate is exported from billing"),
		]);
	});

	it.each([
		[
			"its primary export",
			"src/invoice-routes.ts",
			"export const invoiceRoutesCreate = () => 1;",
		],
		[
			"the subject of its exports",
			"src/cursor.ts",
			"export const cursorEncode = () => 1;",
		],
		[
			"a Use case",
			"src/contexts/billing/application/invoice-create.ts",
			"export const invoiceCreate = () => 1;",
		],
		[
			"an adapter's dot",
			"src/contexts/billing/adapters/outbound/invoice-repository.postgres.ts",
			"export const invoiceRepositoryPostgresCreate = () => 1;",
		],
		[
			"a test helper's package",
			"packages/cli/src/cli-test-app.ts",
			"export const cliTestDocument = {};",
		],
		[
			"a Package entry",
			"packages/authn/src/client.ts",
			"export const authnRefresh = () => 1;",
		],
		["a command", "scripts/app-create.ts", "export const appRender = () => 1;"],
		[
			"a table",
			"src/contexts/billing/adapters/outbound/invoice-table.ts",
			"export const invoice = {};",
		],
		[
			"only types and classes",
			"src/contexts/billing/domain/errors.ts",
			"export class InvoiceNotFoundError {}",
		],
		[
			"only React Router's names",
			"src/ui/routes/invoice-list.tsx",
			"export const meta = () => [];\nexport const headers = () => ({});\nexport const shouldRevalidate = () => true;",
		],
		[
			"its subject, before .server",
			"src/ui/invoice-session.server.ts",
			"export const invoiceSessionRead = () => 1;",
		],
	])("A23 passes a file named after %s", async (_name, path, source) => {
		expect(
			architectureFileNamesCheck([await architectureFileCreate(path, source)]),
		).toEqual([]);
	});

	it("A23 keeps a Use case's verb in the file it suggests", async () => {
		const file = await architectureFileCreate(
			"src/contexts/billing/application/invoice.ts",
			"export const noteCreate = () => 1;\n",
		);
		expect(architectureFileNamesCheck([file])).toEqual([
			expect.stringContaining("(note-create.ts)"),
		]);
	});

	it("A23 fails a file named after none of its exports", async () => {
		const file = await architectureFileCreate(
			"packages/telemetry/src/telemetry-sdk.ts",
			"export const telemetryStart = () => 1;\nexport const telemetryShutdown = () => 1;\n",
		);
		expect(architectureRules["A23"]?.([file])).toEqual([
			"packages/telemetry/src/telemetry-sdk.ts: named after none of its exports (telemetryStart, telemetryShutdown); name the file after its primary export (telemetry-start.ts), or start its exports with telemetrySdk",
		]);
	});

	it("A14 counts only the longest context name a column matches", async () => {
		const table = await architectureFileCreate(
			"src/contexts/trade/adapters/outbound/trade-table.ts",
			'import { uuid } from "drizzle-orm/pg-core";\nexport const t = { workOrderId: uuid("work_order_id") };\n',
		);
		const files = [
			table,
			await architectureFileCreate(
				"src/contexts/order/index.ts",
				"export {};\n",
			),
			await architectureFileCreate(
				"src/contexts/work-order/index.ts",
				"export {};\n",
			),
		];
		expect(architectureRules["A14"]?.(files)).toHaveLength(1);
		expect(architectureRules["A14"]?.(files)[0]).toContain("a work-order id");
	});

	it("A25 lets adapters/inbound/ build its own schema from a Model schema's shape", async () => {
		const route = await architectureFileCreate(
			"src/contexts/bar/adapters/inbound/bar-routes.ts",
			'import { z } from "@hono/zod-openapi";\nimport { Bar } from "../../domain/bar.ts";\n\nexport const BarResponse = z\n\t.object({ name: Bar.shape.name })\n\t.openapi("BarResponse");\n',
		);
		expect(architectureRules["A25"]?.([route])).toEqual([]);
	});

	it("A12 reads the repository ports too", async () => {
		const ports = await architectureFileCreate(
			"src/contexts/bar/domain/repositories.ts",
			"export type BarRepository = { close(): Promise<void> };\n",
		);
		expect(architectureRules["A12"]?.([ports])).toEqual([
			expect.stringContaining("no port declares close"),
		]);
	});

	it("A27 skips comments, tests and adapters", async () => {
		const files = await Promise.all([
			architectureFileCreate(
				"src/contexts/bar/application/bar-get.ts",
				"// The repository throws only for the unexpected.\n/* never throw here */\nexport const barGet = () => 1;\n",
			),
			architectureFileCreate(
				"src/contexts/bar/application/bar-get.test.ts",
				'it("x", () => { throw new Error("x"); });\n',
			),
			architectureFileCreate(
				"src/contexts/bar/adapters/outbound/bar-repository.postgres.ts",
				"export const x = () => { try { return 1; } catch { throw new Error(); } };\n",
			),
		]);
		expect(architectureRules["A27"]?.(files)).toEqual([]);
	});

	const a27Why =
		"// unreachable: only the closed flag changes, so no key breaks.";
	it.each([
		{ body: `${a27Why}\nthrow new Error("unreachable");`, found: 0 },
		{ body: 'const s = "cannot throw; we catch nothing";', found: 0 },
		{ body: "const k = { catch: 1, throw: 2 };\ngen.throw(1);", found: 0 },
		{ body: "// unreachable: a bug\nthrow new Error();", found: 1 },
		{ body: `${a27Why}\nthrow new BarNotFoundError();`, found: 1 },
		{ body: `${a27Why}\n\nthrow new Error();`, found: 1 },
		{
			body: `const s = "${a27Why.slice(1, -1)}";\nthrow new Error();`,
			found: 1,
		},
		{ body: 'const u = "http://x"; throw new Error(u);', found: 1 },
		{ body: 'const g = "/*";\nthrow new Error();\nconst h = "*/";', found: 1 },
		{ body: `${a27Why}\ntry {\n\tx();\n} finally {\n\ty();\n}`, found: 1 },
		{ body: "p.catch(() => 1);", found: 1 },
		{ body: "return Promise .reject(e);", found: 1 },
	])("A27 finds $found in: $body", async ({ body, found }) => {
		const file = await architectureFileCreate(
			"src/contexts/bar/application/bar-close.ts",
			body,
		);
		expect(architectureRules["A27"]?.([file])).toHaveLength(found);
	});

	it("A27 tells a model function to return err", async () => {
		const rule = await architectureFileCreate(
			"src/contexts/bar/domain/bar.ts",
			'export const barOpen = () => {\n\tthrow new Error("closed");\n};\n',
		);
		expect(architectureRules["A27"]?.([rule])).toEqual([
			expect.stringContaining(
				"bar.ts:2: throw in a domain/ file; a model function returns err(new <Name>Error())",
			),
		]);
	});

	it.each(samples)("$name fails $rule", ({ expected, files, rule }) => {
		expect(expected).not.toBe("");
		expect(architectureRules[rule]?.(files)).toContainEqual(
			expect.stringContaining(expected),
		);
	});
});
