import { spawnSync } from "node:child_process";
import {
	type DisposableTempDir,
	existsSync,
	mkdirSync,
	mkdtempDisposableSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type DomainPart,
	domainFilesCreate,
	domainNameRefusal,
	domainParts,
	domainReadsApply,
	domainReadsRefusal,
	domainsPairsFill,
	domainTerm,
	nextStepsText,
	pieceBlocksRemove,
	templateWithoutPieces,
	wiringInsert,
} from "./domain-create.ts";
import {
	filesRead,
	filesWrite,
	templateFilesRender,
} from "./template-render.ts";

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

const appCreate = (context: string): DisposableTempDir => {
	const folder = mkdtempDisposableSync(join(tmpdir(), "domain-create-"));
	const directory = folder.path;
	writeFileSync(join(directory, "CONTEXT.md"), context);
	// Every piece installed, as app-create leaves a Project.
	const dependencies = {
		"@n8io/baseline-analytics": "^1.0.0",
		"@n8io/baseline-cache": "^3.0.0",
		"@n8io/baseline-error-tracking": "^1.0.0",
		"@n8io/baseline-live": "^3.0.0",
		"@n8io/baseline-queue": "^3.0.0",
		"react-router": "^8.5.1",
	};
	writeFileSync(
		join(directory, "package.json"),
		JSON.stringify({ dependencies }),
	);
	return folder;
};

describe("domainNameRefusal", () => {
	it("accepts a kebab-case name the glossary defines", () => {
		using folder = appCreate("**Invoice line**:\nOne line.\n");
		const app = folder.path;

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
		using folder = appCreate("**Invoice line**:\nOne line.\n**Sheep**:\nA.\n");
		const app = folder.path;

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
			wiringInsert({
				project,
				template: templateText,
				path: "src/server.ts",
				names,
				pairsFill: false,
			}).split("\n"),
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
			wiringInsert({
				project: 'import { ENV } from "#env";\n',
				template: templateText,
				path: "src/server.ts",
				names,
				pairsFill: false,
			}),
		).toThrow('src/server.ts: missing marker "// domain-create: routes"');
	});

	it("adds no line at a marker of a part the domain leaves out", () => {
		const template = [
			'import { fooLiveRoutesCreate } from "#domains/foo/api/index.ts";',
			"",
			'app.route("/live/foo", fooLiveRoutesCreate(fooUseCases));',
			"// domain-create: live",
		].join("\n");
		const project = "// domain-create: live";

		expect(
			wiringInsert({
				project,
				template,
				path: "src/server.ts",
				names,
				pairsFill: false,
				partsLeftOut: ["live"],
			}).split("\n"),
		).toEqual([
			'import { invoiceLineLiveRoutesCreate } from "#domains/invoice-line/api/index.ts";',
			"// domain-create: live",
		]);
	});
});

describe("domainReadsRefusal", () => {
	it("refuses a target that is missing, itself, named twice or already reading the new domain", () => {
		using folder = appCreate("**Invoice line**:\nA line.\n");
		const app = folder.path;
		mkdirSync(join(app, "src/domains/customer"), { recursive: true });
		const ports = join(app, "src/domains/customer/ports.ts");
		writeFileSync(ports, "export type CustomerPorts = {};\n");
		const refusal = (reads: string[]) =>
			domainReadsRefusal({ appDirectory: app, names, reads });

		expect(refusal(["customer"])).toBeUndefined();
		expect(refusal(["vendor"])).toContain("no src/domains/vendor/");
		expect(refusal(["invoice-line"])).toContain("cannot read itself");
		expect(refusal(["foo"])).toContain("contains foo");
		expect(refusal(["../customer"])).toContain("is not kebab-case");
		expect(refusal(["customer", "customer"])).toContain("twice");
		writeFileSync(ports, "export type CustomerInvoiceLineReader = {};\n");
		expect(refusal(["customer"])).toContain(
			"customer already reads invoice-line",
		);
	});
});

describe("nextStepsText", () => {
	it("names the codegen step only before a migration exists, and only the parts copied", () => {
		const bare = nextStepsText({
			migrated: false,
			names,
			parts: ["seed"],
			reads: ["customer"],
		});
		expect(bare).toContain("pnpm codegen --name invoice_line_create");
		expect(bare).toContain("src/bridges/invoice-line-customer-reader.ts");
		expect(bare).toContain("invoice-line-seed.ts");
		expect(bare).not.toContain("Schedule");
		expect(bare).not.toContain("pages");

		const full = nextStepsText({
			migrated: true,
			names,
			parts: null,
			reads: [],
		});
		expect(full).not.toContain("codegen");
		expect(full).toContain("Schedule");
		expect(full).toContain("pages");
	});
});

describe("the domain-create command", () => {
	const script = new URL("./domain-create.ts", import.meta.url).pathname;
	const command = (...args: string[]) =>
		spawnSync(process.execPath, [script, ...args], {
			cwd: appRoot,
			encoding: "utf8",
		});

	it("prints its usage for --help and -h and exits 0", () => {
		for (const flag of ["--help", "-h"]) {
			const run = command(flag);
			expect(run.status).toBe(0);
			expect(run.stdout).toContain("Usage: pnpm domain-create <name>");
			expect(run.stdout).toContain("--reads <domain>");
			expect(run.stderr).toBe("");
		}
	});

	it("prints its usage and exits 1 on an unknown flag, with no stack trace", () => {
		const run = command("invoice-line", "--nope");
		expect(run.status).toBe(1);
		expect(run.stderr).toContain("Unknown option '--nope'");
		expect(run.stderr).toContain("Usage:");
		expect(run.stderr).not.toMatch(/\n\s+at /);
	});

	it("refuses a part flag without --bare", () => {
		const run = command("invoice-line", "--schedule");
		expect(run.status).toBe(1);
		expect(run.stderr).toContain("--schedule picks parts for --bare");
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

		expect(
			domainsPairsFill({ project, template, path: "x.ts" }).split("\n"),
		).toEqual([
			'import { a } from "./a.ts";',
			'import { type B } from "./a.ts";',
			"",
			"// domain-create: domains-start",
			"const c = a();",
			"// domain-create: domains-end",
		]);
		expect(() =>
			domainsPairsFill({ project: "", template, path: "x.ts" }),
		).toThrow("x.ts: has 0 domains-start/domains-end pairs, the template 1");
	});
});

describe.runIf(template)("domainFilesCreate on the template", () => {
	const files = template
		? domainFilesCreate({
				templateFull: filesRead(appRoot.pathname),
				appDirectory: appRoot.pathname,
				names,
			})
		: [];
	const file = (path: string) => files.find((f) => f.path === path)?.text ?? "";

	it("refuses to overwrite a file the project already has", () => {
		using folder = appCreate("**Bar**:\nA thing.\n");
		const app = folder.path;
		mkdirSync(join(app, "src/ui/routes"), { recursive: true });
		writeFileSync(join(app, "src/ui/routes/invoice-line-list.tsx"), "mine\n");

		expect(() =>
			domainFilesCreate({
				templateFull: filesRead(appRoot.pathname),
				appDirectory: app,
				names,
			}),
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

		// The first domain with pages (an empty / route pair) brings home.tsx back with its test.
		using folder = appCreate("**Invoice line**:\nA line.\n");
		const app = folder.path;
		mkdirSync(join(app, "src/ui/routes"), { recursive: true });
		writeFileSync(join(app, "src/ui/routes/home.test.ts"), "mine\n");
		writeFileSync(
			join(app, "src/ui/routes.ts"),
			"// domain-create: domains-start\n// domain-create: domains-end\n",
		);
		expect(() =>
			domainFilesCreate({
				templateFull: filesRead(appRoot.pathname),
				appDirectory: app,
				names,
			}),
		).toThrow("src/ui/routes/home.test.ts already exists");
	});

	it("puts the new schedule item at its marker in .env.schema", () => {
		expect(file(".env.schema")).toContain(
			"# @sensitive=false @required=false\nSCHEDULE_INVOICE_LINE_STALE_ARCHIVE=\n# domain-create: schedules",
		);
	});

	it("builds the use cases in src/use-cases.ts and hands them to each composition root", () => {
		expect(file("src/use-cases.ts")).toMatch(
			/telemetryUseCasesTrace\(\s*invoiceLineUseCasesCreate\(invoiceLinePortsCreate\(connections\)\),\s*\);\n\t\/\/ domain-create: use-cases\n/,
		);
		expect(file("src/use-cases.ts")).toContain(
			"invoiceLineUseCases,\n\t\t// domain-create: use-cases-returned",
		);
		expect(file("src/server.ts")).toContain(
			'app.route("/api/v1/invoice-lines", invoiceLineRoutesCreate(useCases.invoiceLineUseCases));\n// domain-create: routes',
		);
		for (const root of ["src/server.ts", "src/worker.ts", "src/seed.ts"]) {
			expect(file(root)).not.toContain("PortsCreate(");
		}
		expect(file("src/worker.ts")).toContain(
			"invoiceLineScheduleCreate(useCases.invoiceLineUseCases),\n\t\t// domain-create: schedules",
		);
		expect(file("src/ui/context.ts")).toContain(
			"[invoiceLineUseCasesContext, useCases.invoiceLineUseCases],",
		);
		expect(file("src/ui/routes.ts")).toContain(
			'route("invoice-lines/:invoiceLineId", "routes/invoice-line-detail.tsx"),',
		);
	});

	// One file or line that only each part brings. Imports do not count: the unused-imports pass
	// drops the ones a left-out part leaves behind.
	const importsDrop = (created: typeof files) =>
		created.map((f) => ({
			path: f.path,
			text: f.text.replaceAll(/^import [\s\S]*?;$/gm, ""),
		}));
	const partSigns: Record<DomainPart, (created: typeof files) => boolean> = {
		analytics: (created) =>
			created.some((f) => f.text.includes("invoiceLineAnalytics")),
		cache: (created) =>
			created.some((f) => f.path.endsWith("/invoice-line-cached.ts")),
		live: (created) =>
			created.some(
				(f) =>
					f.path.endsWith("/invoice-line-live.ts") ||
					/"\/live\/invoice[-_]line"/.test(f.text),
			),
		pages: (created) =>
			created.some(
				(f) =>
					f.path.startsWith("src/ui/routes/invoice-line-") ||
					/invoice-?[lL]ine/.test(f.path.startsWith("src/ui/") ? f.text : ""),
			),
		schedule: (created) =>
			created.some(
				(f) =>
					/StaleArchive|archiveStale|INVOICE_LINE_STALE_ARCHIVE|invoiceLineSchedule/.test(
						f.text,
					) || /stale|schedule/.test(f.path),
			),
		seed: (created) =>
			created.some(
				(f) =>
					f.path.includes("-seed") ||
					f.text.includes("invoiceLineSeed") ||
					(f.path === "src/seed.ts" && f.text.includes("invoiceLine")),
			),
	};
	const bareCreate = (parts: DomainPart[]) =>
		domainFilesCreate({
			templateFull: filesRead(appRoot.pathname),
			appDirectory: appRoot.pathname,
			names,
			parts,
		});

	it("copies a --bare domain with no file or line of any part", () => {
		const bare = bareCreate([]);

		expect(
			domainParts.filter((part) => partSigns[part](importsDrop(bare))),
		).toEqual([]);
		expect(bare.map((f) => f.path)).toEqual(
			expect.arrayContaining([
				"src/domains/invoice-line/models/invoice-line.ts",
				"src/domains/invoice-line/spi/invoice-line-repository.contract.ts",
				"src/domains/invoice-line/spi/invoice-line-transaction.postgres.ts",
				"src/domains/invoice-line/use-cases/invoice-line-update.ts",
				"src/domains/invoice-line/api/invoice-line-routes.ts",
			]),
		);
		expect(
			bare.filter((f) => /domain-create-(start|end)/.test(f.text)),
		).toEqual([]);
	});

	it.each(domainParts)(
		"brings only its own files and lines with --bare --%s",
		(part) => {
			const created = bareCreate([part]);

			expect(
				domainParts.filter((p) => partSigns[p](importsDrop(created))),
			).toEqual([part]);
		},
	);

	it("copies with --bare and every part what it copies without --bare", () => {
		expect(bareCreate([...domainParts])).toEqual(files);
	});

	it("writes the reader, its fake, the Bridge and its wiring for --reads", () => {
		const created = domainFilesCreate({
			templateFull: filesRead(appRoot.pathname),
			appDirectory: appRoot.pathname,
			names,
			parts: [],
			reads: ["customer"],
		});
		const text = (path: string) =>
			created.find((f) => f.path === path)?.text ?? "";

		expect(text("src/domains/invoice-line/ports.ts")).toContain(
			'export type InvoiceLineReaders = Pick<InvoiceLinePorts, "invoiceLineCustomerReader">;',
		);
		expect(text("src/domains/invoice-line/spi/index.ts")).toContain(
			"\treaders: InvoiceLineReaders,\n): InvoiceLinePorts =>",
		);
		expect(text("src/domains/invoice-line/spi/index.ts")).toContain(
			'export { invoiceLineCustomerReaderMemoryCreate } from "./invoice-line-customer-reader.memory.ts";',
		);
		expect(text("src/domains/invoice-line/spi/index.test.ts")).toContain(
			"{ invoiceLineCustomerReader: invoiceLineCustomerReaderMemoryCreate() })",
		);
		expect(text("src/bridges/invoice-line-customer-reader.ts")).toContain(
			'id: "invoice-line-customer-reader"',
		);
		expect(text("src/use-cases.ts")).toContain(
			"invoiceLineCustomerReader: invoiceLineCustomerReaderCreate(customerUseCases)",
		);
		expect(text("src/use-cases.ts")).toContain(
			'import { invoiceLineCustomerReaderCreate } from "#bridges/invoice-line-customer-reader.ts";',
		);
		// Every call of the ports factory passes the readers, so none is left with one argument.
		expect(
			created.filter((f) =>
				/invoiceLinePortsCreate\((connections|\{[^}]*\})\)/.test(f.text),
			),
		).toEqual([]);
	});

	it("fills a first --bare domain's wiring only for its parts, and a later domain's for the parts it brings", () => {
		using folder = mkdtempDisposableSync(join(tmpdir(), "domain-create-"));
		const app = folder.path;
		const templateFull = filesRead(appRoot.pathname);
		filesWrite(
			app,
			templateFilesRender(templateFull, { description: "d", name: "n" }),
		);
		const text = (created: typeof files, path: string) =>
			created.find((f) => f.path === path)?.text ?? "";

		const first = domainFilesCreate({
			templateFull,
			appDirectory: app,
			names,
			parts: [],
		});
		expect(text(first, "src/server.ts")).toContain(
			"const useCases = domainsUseCasesCreate(connections);",
		);
		expect(text(first, "src/server.ts")).not.toContain("seedsRun(useCases)");
		expect(text(first, "src/server.ts")).not.toMatch(/^\s*useCases,$/m);
		expect(text(first, "src/seed.ts")).not.toContain("devSeedActor");
		expect(text(first, "src/worker.ts")).not.toContain(
			"domainsUseCasesCreate(",
		);
		expect(text(first, "src/ui/context.ts")).not.toContain(
			"useCases: DomainsUseCases",
		);
		expect(first.map((f) => f.path)).not.toContain("src/ui/routes/home.tsx");

		filesWrite(app, first);
		const later = domainFilesCreate({
			templateFull,
			appDirectory: app,
			names: { kebab: "customer", plural: "customers" },
			parts: ["pages", "schedule", "seed"],
		});
		expect(text(later, "src/server.ts")).toContain("seedsRun(useCases)");
		expect(text(later, "src/server.ts")).toMatch(/^\s*useCases,$/m);
		expect(text(later, "src/seed.ts")).toContain("...customerScopes");
		expect(text(later, "src/worker.ts")).toContain(
			"const useCases = domainsUseCasesCreate(connections);",
		);
		expect(text(later, "src/ui/context.ts")).toContain(
			"useCases: DomainsUseCases",
		);
		expect(text(later, "src/ui/routes.ts")).toContain(
			'index("routes/home.tsx")',
		);
		expect(later.map((f) => f.path)).toContain("src/ui/routes/home.tsx");
	});

	it("leaves foo's files alone when it reads nothing", () => {
		const template = filesRead(appRoot.pathname);

		expect(domainReadsApply({ files: template, reads: [] })).toBe(template);
	});

	it("leaves out the pieces a Project removed, which have no package left", () => {
		using folder = appCreate("**Invoice line**:\nA line.\n");
		const app = folder.path;
		filesWrite(
			app,
			templateWithoutPieces(filesRead(appRoot.pathname), [
				"analytics",
				"cache",
				"error-tracking",
				"live",
				"queue",
				"ui",
			]),
		);
		writeFileSync(
			join(app, "package.json"),
			JSON.stringify({ dependencies: {} }),
		);

		const created = domainFilesCreate({
			templateFull: filesRead(appRoot.pathname),
			appDirectory: app,
			names,
		});
		const paths = created.map((f) => f.path);
		expect(paths).toContain("src/domains/invoice-line/ports.ts");
		expect(
			paths.filter((p) =>
				/^src\/(ui\/|worker\.ts)|-analytics\.|-live\.|-cached?\.|-schedule\.|-transaction\.postgres\.test/.test(
					p,
				),
			),
		).toEqual([]);
		expect(
			created.filter((f) =>
				/piece-(start|end): (analytics|cache|error-tracking|live|queue|ui)|SCHEDULE_|Analytics/.test(
					f.text,
				),
			),
		).toEqual([]);
		const server = created.find((f) => f.path === "src/server.ts")?.text;
		expect(server).toContain(
			"invoiceLineRoutesCreate(useCases.invoiceLineUseCases)",
		);
		// The import stays for domain-create's unused-imports pass to remove.
		expect(server).not.toContain("invoiceLineLiveRoutesCreate(");
	});
});
