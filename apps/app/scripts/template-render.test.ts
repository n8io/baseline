import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { domainsPairsFill } from "./domain-create.ts";
import {
	domainsPairsFind,
	filesRead,
	fooBlocksFind,
	fooLineIs,
	fooPathRename,
	fooRename,
	linesRemove,
	templateFileRender,
	templateFilesRender,
} from "./template-render.ts";

const appRoot = new URL("../", import.meta.url);
const names = { kebab: "invoice-line", plural: "invoice-lines" };
const answers = { description: "Invoices for small shops.", name: "invoicing" };
const domainsUrl = new URL("src/domains/", appRoot);
// The template itself: foo is its only domain. A project, or this tree after a
// domain-create, skips these tests.
const template =
	existsSync(domainsUrl) &&
	readdirSync(domainsUrl)
		.filter((name) => !name.startsWith("."))
		.join() === "foo";

describe("fooRename", () => {
	it("spells each occurrence the way its place needs", () => {
		const source = [
			'import { fooCreate } from "#domains/foo/use-cases/foo-create.ts";',
			'const foo = idCreate("foo"); // Saves the foo.',
			"const foos: Foo[] = state.foos;",
			'span.setAttribute("baseline.foo.id", foo.id);',
			'publish("foo.created", { fooId }); scope("foo:update");',
			`redirect(\`/foos/\${foo.id}\`); app.route("/live/foo", r);`,
			"process.env.SCHEDULE_FOO_STALE_ARCHIVE; /^foo_/;",
			`throw new Error(\`Foo \${id} not found\`); "foos"; "FooNotFound";`,
		].join("\n");

		expect(fooRename(source, names, "src/x.ts").split("\n")).toEqual([
			'import { invoiceLineCreate } from "#domains/invoice-line/use-cases/invoice-line-create.ts";',
			'const invoiceLine = idCreate("invoice_line"); // Saves the invoice line.',
			"const invoiceLines: InvoiceLine[] = state.invoiceLines;",
			'span.setAttribute("baseline.invoice_line.id", invoiceLine.id);',
			'publish("invoice-line.created", { invoiceLineId }); scope("invoice-line:update");',
			`redirect(\`/invoice-lines/\${invoiceLine.id}\`); app.route("/live/invoice_line", r);`,
			"process.env.SCHEDULE_INVOICE_LINE_STALE_ARCHIVE; /^invoice_line_/;",
			`throw new Error(\`Invoice line \${id} not found\`); "invoice-lines"; "InvoiceLineNotFound";`,
		]);
	});

	it("reads JSX text as UI copy", () => {
		const source = [
			"<h1>Foos</h1>",
			"<CardTitle>New foo</CardTitle>",
			"\t\t\t\tBack to foos",
			"<p>Delete this foo?</p>",
			"{foo.name} {items.map((foo) => foo.id)}",
			"<p>Foos</p> {foo.name}",
			'"A foo named it already exists"',
		].join("\n");

		expect(fooRename(source, names, "src/ui/routes/x.tsx").split("\n")).toEqual(
			[
				"<h1>Invoice lines</h1>",
				"<CardTitle>New invoice line</CardTitle>",
				"\t\t\t\tBack to invoice lines",
				"<p>Delete this invoice line?</p>",
				"{invoiceLine.name} {items.map((invoiceLine) => invoiceLine.id)}",
				"<p>Invoice lines</p> {invoiceLine.name}",
				'"A invoice line named it already exists"',
			],
		);
	});

	it("renames paths", () => {
		expect(
			fooPathRename("src/domains/foo/spi/foo-ports.memory.ts", names),
		).toBe("src/domains/invoice-line/spi/invoice-line-ports.memory.ts");
		expect(fooPathRename("src/ui/routes/foo-list.tsx", names)).toBe(
			"src/ui/routes/invoice-line-list.tsx",
		);
	});
});

describe("fooBlocksFind", () => {
	it("never matches a longer word such as Footer", () => {
		expect(fooLineIs("<AlertDialogFooter>")).toBe(false);
		expect(fooLineIs("const food = 1;")).toBe(false);
		expect(fooLineIs("fooScopes,")).toBe(true);
	});

	it("takes the whole statement a foo line belongs to", () => {
		const text = [
			"import {", // 0
			"\ttype FooUseCases,",
			"\tbarScopes,",
			'} from "#domains/foo/index.ts";',
			"const bar = 1;", // 4
			"const fooUseCases = trace(", // 5
			"\tfooUseCasesCreate(ports),",
			");",
			"const scopes = [", // 8
			"\t...fooScopes,",
			"\t// domain-create: scopes",
			"];",
			"await db.query(", // 12
			"\t`UPDATE foo.foo",
			"\t SET archived = true`,",
			");",
		].join("\n");

		expect(fooBlocksFind(text, "src/server.ts")).toEqual([
			[0, 3],
			[5, 7],
			[9, 9],
			[12, 15],
		]);
	});

	it("reads regexes and JSX closing tags without miscounting brackets", () => {
		const text = [
			"const fooOpen = (s: string) => {", // 0
			"\treturn /\\(foo/.test(s);",
			"};",
			"<nav>", // 3
			'\t<Link to="/bars">Bars</Link>',
			'\t<Link to="/foos">Foos</Link>',
			'\t<Link to="/bazs">Bazs</Link>',
			"</nav>",
		].join("\n");

		expect(fooBlocksFind(text, "src/ui/root.tsx")).toEqual([
			[0, 2],
			[5, 5],
		]);
	});

	it("stops with the file and line when a statement never closes", () => {
		expect(() =>
			fooBlocksFind("const foo = trace(\n\tbar,", "src/x.ts"),
		).toThrow("src/x.ts:1: cannot find the statement");
	});

	it("takes an env item's decorator lines with it", () => {
		const text = [
			"# schedule overrides",
			"# @sensitive=false @required=false",
			"SCHEDULE_FOO_STALE_ARCHIVE=",
			"# domain-create: schedules",
		].join("\n");

		expect(fooBlocksFind(text, ".env.schema")).toEqual([[1, 2]]);
	});
});

describe("templateFileRender", () => {
	it("drops only the Foo entry from CONTEXT.md and writes the description", () => {
		const text =
			"# A starter app.\n\n## Architecture\n\n**Use case**:\nSuch as creating a foo (`fooCreate`).\n_Avoid_: Service\n\n## Language\n\n**Foo**:\nThe example.\n_Avoid_: widget\n";

		expect(templateFileRender({ path: "CONTEXT.md", text }, answers)).toEqual({
			path: "CONTEXT.md",
			text: "# Invoices for small shops.\n\n## Architecture\n\n**Use case**:\nSuch as creating a foo (`fooCreate`).\n_Avoid_: Service\n\n## Language\n",
		});
	});

	it("deletes foo's own files and keeps the scripts as they are", () => {
		for (const path of [
			"src/domains/foo/index.ts",
			"src/ui/routes/foo-list.tsx",
			"src/ui/routes/foo-list.test.ts",
			"src/ui/routes/home.tsx",
			"src/ui/routes/home.test.ts",
			"src/server-seed.test.ts",
			"test/integration/foo-live.test.ts",
			"migrations/20261103125512_foo_create/migration.sql",
			"CHANGELOG.md",
		]) {
			expect(
				templateFileRender({ path, text: "foo" }, answers),
			).toBeUndefined();
		}
		const script = { path: "scripts/x.ts", text: "const foo = 1;\n" };
		expect(templateFileRender(script, answers)).toEqual(script);
	});

	it("makes biome.json a root config and names the package", () => {
		const biome = templateFileRender(
			{
				path: "biome.json",
				text: '{\n\t"$schema": "x",\n\t"root": false,\n\t"a": 1\n}\n',
			},
			answers,
		);
		const manifest = templateFileRender(
			{
				path: "package.json",
				text: '{ "name": "app", "version": "1.4.0", "private": true }',
			},
			answers,
		);

		expect(biome?.text).toBe('{\n\t"$schema": "x",\n\t"a": 1\n}\n');
		expect(JSON.parse(manifest?.text ?? "")).toEqual({
			name: "invoicing",
			private: true,
		});
	});
});

describe.runIf(template)("the template's own files", () => {
	const files = template ? filesRead(appRoot.pathname) : [];

	it("render with no foo left outside the scripts", () => {
		const rendered = templateFilesRender(files, answers);
		const leftovers = rendered
			.filter((f) => !/^(scripts|test\/unit\/scripts)\//.test(f.path))
			.filter((f) => f.path !== "CONTEXT.md")
			.flatMap((f) =>
				f.text
					.split("\n")
					.filter(fooLineIs)
					.map((line) => `${f.path}: ${line}`),
			);

		expect(leftovers).toEqual([]);
		expect(rendered.map((f) => f.path)).toContain("src/domains/.gitkeep");
		// React Router serves static files from public/.
		expect(rendered.map((f) => f.path)).toContain("public/.gitkeep");
	});

	it("empty every domains-start/domains-end pair, which domainsPairsFill fills back exactly", () => {
		const paired = files.filter((f) => domainsPairsFind(f.text, f.path).length);

		expect(paired.map((f) => f.path)).toEqual([
			"src/seed.ts",
			"src/server.ts",
			"src/ui/context.ts",
			"src/ui/routes.ts",
		]);
		for (const { path, text } of paired) {
			const rendered = templateFileRender({ path, text }, answers)?.text ?? "";
			const pairs = domainsPairsFind(rendered, path);

			expect(pairs.every(([start, end]) => end === start + 1)).toBe(true);
			expect(domainsPairsFill(rendered, text, path)).toBe(
				linesRemove(text, fooBlocksFind(text, path)),
			);
		}
	});
});
