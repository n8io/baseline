import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	domainFilesCreate,
	domainNameRefusal,
	domainsPairsFill,
	domainTerm,
	pieceBlocksRemove,
	templateWithoutPieces,
	wiringInsert,
} from "./domain-create.ts";
import { filesRead, filesWrite } from "./template-render.ts";

const appRoot = new URL("../", import.meta.url);
const names = { kebab: "invoice-line", plural: "invoice-lines" };
const domainsUrl = new URL("src/domains/", appRoot);
// The template itself: foo is its only domain. A project, or this tree after a
// domain-create, skips these tests.
const template =
	existsSync(domainsUrl) &&
	readdirSync(domainsUrl)
		.filter((name) => !name.startsWith("."))
		.join() === "foo";

const directories: string[] = [];
afterEach(() => {
	for (const d of directories.splice(0))
		rmSync(d, { force: true, recursive: true });
});

const appCreate = (context: string): string => {
	const directory = mkdtempSync(join(tmpdir(), "domain-create-"));
	directories.push(directory);
	writeFileSync(join(directory, "CONTEXT.md"), context);
	// Every piece installed, as app-create leaves a Project.
	const dependencies = {
		"@n8io/baseline-live": "^3.0.0",
		"react-router": "^8.5.1",
	};
	writeFileSync(
		join(directory, "package.json"),
		JSON.stringify({ dependencies }),
	);
	return directory;
};

describe("domainNameRefusal", () => {
	it("accepts a kebab-case name the glossary defines", () => {
		const app = appCreate("**Invoice line**:\nOne line.\n");

		expect(domainTerm("invoice-line")).toBe("Invoice line");
		expect(domainNameRefusal(names, app)).toBeUndefined();
	});

	it.each([
		[{ kebab: "InvoiceLine", plural: "invoice-lines" }, "not kebab-case"],
		[{ kebab: "invoice-line", plural: "invoice_lines" }, "not kebab-case"],
		[{ kebab: "foo-bar", plural: "foo-bars" }, "contains foo"],
		[{ kebab: "sheep", plural: "sheep" }, "must differ"],
		[{ kebab: "customer", plural: "customers" }, "no **Customer**: entry"],
	])("refuses %j", (refused, reason) => {
		const app = appCreate("**Invoice line**:\nOne line.\n**Sheep**:\nA.\n");

		expect(domainNameRefusal(refused, app)).toContain(reason);
	});
});

describe("wiringInsert", () => {
	const templateText = [
		'import { fooRoutesCreate } from "#domains/foo/api/index.ts";',
		'import { ENV } from "#env";',
		"",
		'app.route("/api/v1/foos", fooRoutesCreate(fooUseCases));',
		"// domain-create: routes",
	].join("\n");

	it("adds the renamed lines above the same marker and after the imports", () => {
		const project = [
			'import { barRoutesCreate } from "#domains/bar/api/index.ts";',
			'import { ENV } from "#env";',
			"",
			'app.route("/api/v1/bars", barRoutesCreate(barUseCases));',
			"// domain-create: routes",
		].join("\n");

		expect(
			wiringInsert(project, templateText, "src/server.ts", names, false).split(
				"\n",
			),
		).toEqual([
			'import { barRoutesCreate } from "#domains/bar/api/index.ts";',
			'import { ENV } from "#env";',
			'import { invoiceLineRoutesCreate } from "#domains/invoice-line/api/index.ts";',
			"",
			'app.route("/api/v1/bars", barRoutesCreate(barUseCases));',
			'app.route("/api/v1/invoice-lines", invoiceLineRoutesCreate(invoiceLineUseCases));',
			"// domain-create: routes",
		]);
	});

	it("stops and names the file when the project lost a marker", () => {
		expect(() =>
			wiringInsert(
				'import { ENV } from "#env";\n',
				templateText,
				"src/server.ts",
				names,
				false,
			),
		).toThrow('src/server.ts: missing marker "// domain-create: routes"');
	});
});

describe("pieceBlocksRemove", () => {
	it("drops each block of the named piece, in // and # comments, and keeps the rest", () => {
		const text = [
			"a",
			"\t// piece-start: live",
			"\tlive();",
			"\t// piece-end: live",
			"// piece-start: ui",
			"page();",
			"// piece-end: ui",
			"# piece-start: live",
			"live: true",
			"# piece-end: live",
			"b",
			"",
		].join("\n");

		expect(pieceBlocksRemove(text, "live")).toBe(
			["a", "// piece-start: ui", "page();", "// piece-end: ui", "b", ""].join(
				"\n",
			),
		);
	});
});

describe("domainsPairsFill", () => {
	it("fills an emptied pair without foo's lines and imports what the render dropped", () => {
		const template = [
			'import { a, type B } from "./a.ts";',
			'import { foo } from "./foo.ts";',
			"// domain-create: domains-start",
			"const b: B = a(foo);",
			"const c = a();",
			"// domain-create: domains-end",
		].join("\n");
		const project = [
			"// domain-create: domains-start",
			"// domain-create: domains-end",
		].join("\n");

		expect(domainsPairsFill(project, template, "x.ts").split("\n")).toEqual([
			'import { a } from "./a.ts";',
			'import { type B } from "./a.ts";',
			"// domain-create: domains-start",
			"const c = a();",
			"// domain-create: domains-end",
		]);
		expect(() => domainsPairsFill("", template, "x.ts")).toThrow(
			"x.ts: has 0 domains-start/domains-end pairs, the template 1",
		);
	});
});

describe.runIf(template)("domainFilesCreate on the template", () => {
	const files = template
		? domainFilesCreate(filesRead(appRoot.pathname), appRoot.pathname, names)
		: [];
	const file = (path: string) => files.find((f) => f.path === path)?.text ?? "";

	it("refuses to overwrite a file the project already has", () => {
		const app = appCreate("**Bar**:\nA thing.\n");
		mkdirSync(join(app, "src/ui/routes"), { recursive: true });
		writeFileSync(join(app, "src/ui/routes/invoice-line-list.tsx"), "mine\n");

		expect(() =>
			domainFilesCreate(filesRead(appRoot.pathname), app, names),
		).toThrow("src/ui/routes/invoice-line-list.tsx already exists");
	});

	it("copies the foo domain and both pages, renamed", () => {
		const paths = files.map((f) => f.path);

		expect(paths).toContain("src/domains/invoice-line/models/invoice-line.ts");
		expect(paths).toContain(
			"src/domains/invoice-line/api/invoice-line-routes.ts",
		);
		expect(paths).toContain("src/ui/routes/invoice-line-list.tsx");
		expect(paths).toContain("src/ui/routes/invoice-line-detail.tsx");
		expect(paths.filter((p) => /foo/.test(p))).toEqual([]);
	});

	it("copies both page tests, renamed, and the home test only with a first domain", () => {
		const paths = files.map((f) => f.path);

		expect(paths).toContain("src/ui/routes/invoice-line-list.test.ts");
		expect(paths).toContain("src/ui/routes/invoice-line-detail.test.ts");
		expect(file("src/ui/routes/invoice-line-list.test.ts")).toContain(
			'from "#ui/routes/invoice-line-list.tsx"',
		);
		expect(paths).not.toContain("src/ui/routes/home.test.ts");
		expect(paths).not.toContain("src/ui/routes/home.tsx");

		// A first domain (no folder in src/domains) brings home.tsx back with its test.
		const app = appCreate("**Invoice line**:\nA line.\n");
		mkdirSync(join(app, "src/ui/routes"), { recursive: true });
		writeFileSync(join(app, "src/ui/routes/home.test.ts"), "mine\n");
		expect(() =>
			domainFilesCreate(filesRead(appRoot.pathname), app, names),
		).toThrow("src/ui/routes/home.test.ts already exists");
	});

	it("puts the new schedule item at its marker in .env.schema", () => {
		expect(file(".env.schema")).toContain(
			"# @sensitive=false @required=false\nSCHEDULE_INVOICE_LINE_STALE_ARCHIVE=\n# domain-create: schedules",
		);
	});

	it("wires the use cases, routes and schedule in each composition root", () => {
		expect(file("src/server.ts")).toContain(
			'app.route("/api/v1/invoice-lines", invoiceLineRoutesCreate(invoiceLineUseCases));\n// domain-create: routes',
		);
		for (const root of ["src/server.ts", "src/worker.ts", "src/seed.ts"]) {
			expect(file(root)).toMatch(
				/telemetryUseCasesTrace\(\s*invoiceLineUseCasesCreate\(invoiceLinePortsCreate\(ports\)\),/,
			);
		}
		expect(file("src/worker.ts")).toContain(
			"invoiceLineScheduleCreate(invoiceLineUseCases),\n\t\t// domain-create: schedules",
		);
		expect(file("src/ui/routes.ts")).toContain(
			'route("invoice-lines/:invoiceLineId", "routes/invoice-line-detail.tsx"),',
		);
	});

	it("leaves out the pieces a Project removed, which have no package left", () => {
		const app = appCreate("**Invoice line**:\nA line.\n");
		filesWrite(
			app,
			templateWithoutPieces(filesRead(appRoot.pathname), ["live", "ui"]),
		);
		writeFileSync(
			join(app, "package.json"),
			JSON.stringify({ dependencies: {} }),
		);

		const created = domainFilesCreate(filesRead(appRoot.pathname), app, names);
		const paths = created.map((f) => f.path);
		expect(paths).toContain("src/domains/invoice-line/ports.ts");
		expect(paths.filter((p) => /^src\/ui\/|-live\./.test(p))).toEqual([]);
		expect(
			created.filter((f) => /piece-(start|end): (live|ui)/.test(f.text)),
		).toEqual([]);
		const server = created.find((f) => f.path === "src/server.ts")?.text;
		expect(server).toContain("invoiceLineRoutesCreate(invoiceLineUseCases)");
		// The import stays for domain-create's unused-imports pass to remove.
		expect(server).not.toContain("invoiceLineLiveRoutesCreate(");
	});
});
