import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	domainFilesCreate,
	domainNameRefusal,
	domainTerm,
	wiringInsert,
} from "../../../scripts/domain-create.ts";
import { templateWorkingTree } from "../../../scripts/template-render.ts";

const appRoot = new URL("../../../", import.meta.url);
const names = { kebab: "invoice-line", plural: "invoice-lines" };
const template = existsSync(new URL("src/domains/foo/", appRoot));

const directories: string[] = [];
afterEach(() => {
	for (const d of directories.splice(0))
		rmSync(d, { force: true, recursive: true });
});

const appCreate = (context: string): string => {
	const directory = mkdtempSync(join(tmpdir(), "domain-create-"));
	directories.push(directory);
	writeFileSync(join(directory, "CONTEXT.md"), context);
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
		'import { fooRoutes } from "#domains/foo/api/index.ts";',
		'import { ENV } from "#env";',
		"",
		'app.route("/api/v1/foos", fooRoutes(fooUseCases));',
		"// domain-create: routes",
	].join("\n");

	it("adds the renamed lines above the same marker and after the imports", () => {
		const project = [
			'import { barRoutes } from "#domains/bar/api/index.ts";',
			'import { ENV } from "#env";',
			"",
			'app.route("/api/v1/bars", barRoutes(barUseCases));',
			"// domain-create: routes",
		].join("\n");

		expect(
			wiringInsert(project, templateText, "src/server.ts", names, false).split(
				"\n",
			),
		).toEqual([
			'import { barRoutes } from "#domains/bar/api/index.ts";',
			'import { ENV } from "#env";',
			'import { invoiceLineRoutes } from "#domains/invoice-line/api/index.ts";',
			"",
			'app.route("/api/v1/bars", barRoutes(barUseCases));',
			'app.route("/api/v1/invoice-lines", invoiceLineRoutes(invoiceLineUseCases));',
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

describe.runIf(template)("domainFilesCreate on the template", () => {
	const files = template
		? domainFilesCreate(
				templateWorkingTree(appRoot.pathname),
				appRoot.pathname,
				names,
			)
		: [];
	const file = (path: string) => files.find((f) => f.path === path)?.text ?? "";

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

	it("puts the new schedule item at its marker in .env.schema", () => {
		expect(file(".env.schema")).toContain(
			"# @sensitive=false @required=false\nSCHEDULE_INVOICE_LINE_STALE_ARCHIVE=\n# domain-create: schedules",
		);
	});

	it("wires the use cases, routes and schedule in each composition root", () => {
		expect(file("src/server.ts")).toContain(
			'app.route("/api/v1/invoice-lines", invoiceLineRoutes(invoiceLineUseCases));\n// domain-create: routes',
		);
		for (const root of ["src/server.ts", "src/worker.ts", "src/seed.ts"]) {
			expect(file(root)).toMatch(
				/telemetryUseCasesTrace\(\s*invoiceLineUseCasesCreate\(invoiceLinePortsCreate\(ports\)\),/,
			);
		}
		expect(file("src/worker.ts")).toContain(
			"invoiceLineSchedule(invoiceLineUseCases),\n\t\t// domain-create: schedules",
		);
		expect(file("src/ui/routes.ts")).toContain(
			'route("invoice-lines/:invoiceLineId", "routes/invoice-line-detail.tsx"),',
		);
	});
});
