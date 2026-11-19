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
	type AggregatePart,
	aggregateFilesCreate,
	aggregateLineIs,
	aggregateParts,
	aggregateRefusal,
	barLineIs,
	contextAggregateRename,
	contextReadsFind,
	contextsPairsFill,
	nameRefusal,
	nameTerm,
	nextStepsText,
	pieceBlocksRemove,
	piecesRemovedFind,
	readsApply,
	readsRefusal,
	templateWithoutPieces,
	wiringInsert,
} from "./aggregate-create.ts";
import { contextFilesCreate } from "./context-create.ts";
import {
	filesRead,
	filesWrite,
	fooRename,
	type TemplateFile,
	templateFilesRender,
} from "./template-render.ts";

// The files this test reads or runs from disk, so `pnpm test --changed` runs it when one changes.
import.meta.glob(
	[
		"../**",
		"../**/.*",
		"../.*/**",
		"!../.git/**",
		"!../.react-router/**",
		"!**/*.md",
	],
	{ query: "?raw" },
);
import.meta.glob(["../CONTEXT.md", "../src/contexts/*/CONTEXT.md"], {
	query: "?raw",
});

const appRoot = new URL("../", import.meta.url);
const names = { kebab: "invoice-line", plural: "invoice-lines" };
const billing = { kebab: "billing", plural: "billings" };
const contextsUrl = new URL("src/contexts/", appRoot);
// The template itself: foo is its only context. A project, or this tree after a context-create,
// skips these tests.
const template =
	existsSync(contextsUrl) &&
	readdirSync(contextsUrl)
		.filter((name) => !name.startsWith("."))
		.join() === "foo";

const appCreate = (context: string): DisposableTempDir => {
	const folder = mkdtempDisposableSync(join(tmpdir(), "aggregate-create-"));
	const directory = folder.path;
	// The billing context's own glossary, which aggregate-create reads its Aggregates' terms from.
	mkdirSync(join(directory, "src/contexts/billing"), { recursive: true });
	writeFileSync(join(directory, "src/contexts/billing/CONTEXT.md"), context);
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

describe("nameRefusal and aggregateRefusal", () => {
	it("accepts a kebab-case name the glossary defines", () => {
		using folder = appCreate("**Invoice line**:\nOne line.\n");
		const app = folder.path;
		mkdirSync(join(app, "src/contexts/billing"), { recursive: true });
		writeFileSync(join(app, "src/contexts/billing/index.ts"), "");

		expect(nameTerm("invoice-line")).toBe("Invoice line");
		expect(
			nameRefusal({
				appDirectory: app,
				context: "billing",
				kebab: "invoice-line",
			}),
		).toBeUndefined();
		expect(
			aggregateRefusal({
				aggregate: names,
				appDirectory: app,
				context: "billing",
			}),
		).toBeUndefined();
	});

	it.each([
		[{ kebab: "InvoiceLine", plural: "invoice-lines" }, "not kebab-case"],
		[{ kebab: "invoice-line", plural: "invoice_lines" }, "not kebab-case"],
		[{ kebab: "foo-thing", plural: "foo-things" }, "contains foo"],
		[{ kebab: "sheep", plural: "sheep" }, "must differ"],
		[{ kebab: "doc", plural: "docs" }, "API reference"],
		[{ kebab: "customer", plural: "customers" }, "no **Customer**: entry"],
	])("refuses the Aggregate %j", (refused, reason) => {
		using folder = appCreate("**Invoice line**:\nOne line.\n**Sheep**:\nA.\n");
		const app = folder.path;
		mkdirSync(join(app, "src/contexts/billing"), { recursive: true });
		writeFileSync(join(app, "src/contexts/billing/index.ts"), "");

		expect(
			aggregateRefusal({
				aggregate: refused,
				appDirectory: app,
				context: "billing",
			}),
		).toContain(reason);
	});

	it("refuses a context that does not exist, and an Aggregate it already holds", () => {
		using folder = appCreate("**Invoice line**:\nOne line.\n");
		const app = folder.path;
		const refusal = () =>
			aggregateRefusal({
				aggregate: names,
				appDirectory: app,
				context: "billing",
			});

		expect(refusal()).toContain("make it with pnpm context-create billing");
		mkdirSync(join(app, "src/contexts/billing/domain"), { recursive: true });
		writeFileSync(join(app, "src/contexts/billing/index.ts"), "");
		writeFileSync(join(app, "src/contexts/billing/domain/invoice-line.ts"), "");
		expect(refusal()).toContain("domain/invoice-line.ts already exists");
		mkdirSync(join(app, "src/contexts/crm/domain"), { recursive: true });
		const crm = () =>
			aggregateRefusal({ aggregate: names, appDirectory: app, context: "crm" });
		writeFileSync(join(app, "src/contexts/crm/index.ts"), "");
		expect(crm()).toContain(
			"src/contexts/billing/domain/invoice-line.ts already exists",
		);
		expect(
			aggregateRefusal({
				aggregate: { kebab: "billing", plural: "billings" },
				appDirectory: app,
				context: "crm",
			}),
		).toContain("src/contexts/billing/ is another context");
	});
});

describe("contextAggregateRename", () => {
	it("spells the context where foo is the context and the Aggregate everywhere else", () => {
		const text = [
			'import type { FooPorts } from "../application/ports.ts";',
			'import { fooPortsMemoryCreate } from "../adapters/outbound/foo-ports.memory.ts";',
			'import { fooDeleteCan } from "#contexts/foo/domain/foo-delete-can.ts";',
			"export const fooDelete = (ports: FooPorts) => ports.fooTransaction(async (t) => t.fooRepository);",
			'const key = "foo.deleted";',
			'export const fooSchema = pgSchema("foo");',
		].join("\n");

		expect(
			contextAggregateRename({
				aggregate: names,
				context: billing,
				path: "src/contexts/foo/application/foo-delete.ts",
				text,
			}).split("\n"),
		).toEqual([
			'import type { BillingPorts } from "../application/ports.ts";',
			'import { billingPortsMemoryCreate } from "../adapters/outbound/billing-ports.memory.ts";',
			'import { invoiceLineDeleteCan } from "#contexts/billing/domain/invoice-line-delete-can.ts";',
			"export const invoiceLineDelete = (ports: BillingPorts) => ports.billingTransaction(async (t) => t.invoiceLineRepository);",
			'const key = "invoice-line.deleted";',
			'export const invoiceLineSchema = pgSchema("billing");',
		]);
	});

	it("tells a line of the Aggregate from a line of the context, and finds Bar's", () => {
		expect(aggregateLineIs("\tfooClock: Clock;")).toBe(false);
		expect(
			aggregateLineIs("\tfooTransaction: fooTransactionMemoryCreate(state),"),
		).toBe(false);
		expect(aggregateLineIs("\tfooReadRepository: FooReadRepository;")).toBe(
			true,
		);
		expect(
			aggregateLineIs(
				'app.route("/api/v1/foos", fooRoutesCreate(useCases.fooUseCases));',
			),
		).toBe(true);
		expect(barLineIs("\tbarRepository: BarRepository;")).toBe(true);
		expect(barLineIs("// a toolbar and a barrier")).toBe(false);
		expect(barLineIs('\tscopes: ["bar:read"],')).toBe(false);
		expect(barLineIs('<nav className="nav-bar">')).toBe(false);
		expect(barLineIs('\tbars: new Map<Id<"bar">, Bar>(),')).toBe(true);
		expect(barLineIs('export * from "./domain/bar.ts";')).toBe(true);
		expect(barLineIs("\t// invariant: a Bar never outlives its Foo.")).toBe(
			true,
		);
	});
});

describe("wiringInsert", () => {
	const rename = (text: string) =>
		contextAggregateRename({
			aggregate: names,
			context: billing,
			path: "src/server.ts",
			text,
		});
	const templateText = [
		'import { fooRoutesCreate } from "#contexts/foo/adapters/inbound/index.ts";',
		'import { ENV } from "#env";',
		"",
		'app.route("/api/v1/foos", fooRoutesCreate(useCases.fooUseCases));',
		"// wiring: routes",
	].join("\n");

	it("adds the renamed lines above the same marker and after the imports, once", () => {
		const project = [
			'import { customerRoutesCreate } from "#contexts/customer/adapters/inbound/index.ts";',
			'import { ENV } from "#env";',
			"",
			'app.route("/api/v1/customers", customerRoutesCreate(useCases.customerUseCases));',
			"// wiring: routes",
		].join("\n");
		const inserted = wiringInsert({
			blockIs: aggregateLineIs,
			path: "src/server.ts",
			project,
			rename,
			template: templateText,
		});

		expect(inserted.split("\n")).toEqual([
			'import { customerRoutesCreate } from "#contexts/customer/adapters/inbound/index.ts";',
			'import { ENV } from "#env";',
			'import { invoiceLineRoutesCreate } from "#contexts/billing/adapters/inbound/index.ts";',
			"",
			'app.route("/api/v1/customers", customerRoutesCreate(useCases.customerUseCases));',
			'app.route("/api/v1/invoice-lines", invoiceLineRoutesCreate(useCases.billingUseCases));',
			"// wiring: routes",
		]);
		expect(
			wiringInsert({
				blockIs: aggregateLineIs,
				path: "src/server.ts",
				project: inserted,
				rename,
				template: templateText,
			}),
		).toBe(inserted);
	});

	it("adds a line whose text sits inside a longer name, and skips one Biome reflowed", () => {
		const order = (text: string) =>
			contextAggregateRename({
				aggregate: { kebab: "order", plural: "orders" },
				context: { kebab: "order", plural: "orders" },
				path: "src/use-cases.ts",
				text,
			});
		const insert = (project: string, template: string) =>
			wiringInsert({
				blockIs: (line) => line.includes("foo"),
				path: "src/use-cases.ts",
				project,
				rename: order,
				template,
			});
		const returned = "return {\n\tfooUseCases,\n\t// wiring: returned\n};";
		const suborder = "return {\n\tsuborderUseCases,\n\t// wiring: returned\n};";

		expect(insert(suborder, returned)).toBe(
			"return {\n\tsuborderUseCases,\n\torderUseCases,\n\t// wiring: returned\n};",
		);
		const map =
			"new Map([\n\t[fooUseCasesContext, useCases.fooUseCases],\n\t// wiring: ui\n]);";
		const reflowed =
			"new Map([\n\t[\n\t\torderUseCasesContext,\n\t\tuseCases.orderUseCases,\n\t],\n\t// wiring: ui\n]);";
		expect(insert(reflowed, map)).toBe(reflowed);
	});

	it("stops and names the file when the project lost a marker", () => {
		expect(() =>
			wiringInsert({
				blockIs: aggregateLineIs,
				path: "src/server.ts",
				project: 'import { ENV } from "#env";\n',
				rename,
				template: templateText,
			}),
		).toThrow('src/server.ts: missing marker "// wiring: routes"');
	});

	it("adds no line at a marker of a part the Aggregate leaves out", () => {
		const template = [
			'import { fooLiveRoutesCreate } from "#contexts/foo/adapters/inbound/index.ts";',
			"",
			'app.route("/live/foo", fooLiveRoutesCreate(useCases.fooUseCases));',
			"// wiring: live",
		].join("\n");

		expect(
			wiringInsert({
				blockIs: aggregateLineIs,
				partsLeftOut: ["live"],
				path: "src/server.ts",
				project: "// wiring: live",
				rename,
				template,
			}).split("\n"),
		).toEqual([
			'import { invoiceLineLiveRoutesCreate } from "#contexts/billing/adapters/inbound/index.ts";',
			"// wiring: live",
		]);
	});

	it("in a context file, takes a block's comment and piece lines to the next marker down", () => {
		const template = [
			'import { cacheCreate } from "@n8io/baseline-cache";',
			"export const fooPortsCreate = (): FooPorts => ({",
			"\t// piece-start: cache",
			"\t// The read-through cache.",
			"\tfooCache: cacheCreate(store),",
			"\t// piece-end: cache",
			"\tfooReadRepository: repositories.fooReadRepository,",
			"\t// wiring: ports",
			"\tfooClock: clockSystemCreate(),",
			"});",
		].join("\n");
		const project = [
			"export const billingPortsCreate = (): BillingPorts => ({",
			"\t// wiring: ports",
			"\tbillingClock: clockSystemCreate(),",
			"});",
		].join("\n");

		expect(
			wiringInsert({
				blockIs: aggregateLineIs,
				path: "src/contexts/foo/adapters/outbound/index.ts",
				project,
				rename,
				template,
			}).split("\n"),
		).toEqual([
			'import { cacheCreate } from "@n8io/baseline-cache";',
			"",
			"export const billingPortsCreate = (): BillingPorts => ({",
			"\t// piece-start: cache",
			"\t// The read-through cache.",
			"\tinvoiceLineCache: cacheCreate(store),",
			"\t// piece-end: cache",
			"\tinvoiceLineReadRepository: repositories.invoiceLineReadRepository,",
			"\t// wiring: ports",
			"\tbillingClock: clockSystemCreate(),",
			"});",
		]);
	});
});

describe("contextsPairsFill", () => {
	it("fills the pairs a command wants without foo's lines, and imports what the render dropped", () => {
		const template = [
			'import { a, type B } from "./a.ts";',
			'import { foo } from "./foo.ts";',
			"// wiring: contexts-start",
			"const b: B = a(foo);",
			"const c = a();",
			"// wiring: contexts-end",
		].join("\n");
		const project = [
			"// wiring: contexts-start",
			"// wiring: contexts-end",
		].join("\n");

		expect(
			contextsPairsFill({
				pairWanted: (part) => part === undefined,
				path: "x.ts",
				project,
				template,
			}).split("\n"),
		).toEqual([
			'import { a } from "./a.ts";',
			'import { type B } from "./a.ts";',
			"",
			"// wiring: contexts-start",
			"const c = a();",
			"// wiring: contexts-end",
		]);
		expect(
			contextsPairsFill({
				pairWanted: () => false,
				path: "x.ts",
				project,
				template,
			}),
		).not.toContain("const c");
		expect(() =>
			contextsPairsFill({
				pairWanted: () => true,
				path: "x.ts",
				project: "",
				template,
			}),
		).toThrow("x.ts: has 0 contexts-start/contexts-end pairs, the template 1");
	});
});

describe("readsRefusal and contextReadsFind", () => {
	it("refuses a target that is missing, itself, named twice or already reading the new context", () => {
		using folder = appCreate("**Billing**:\nA context.\n");
		const app = folder.path;
		mkdirSync(join(app, "src/contexts/customer/application"), {
			recursive: true,
		});
		const ports = join(app, "src/contexts/customer/application/ports.ts");
		writeFileSync(ports, "export type CustomerPorts = {};\n");
		const refusal = (reads: string[]) =>
			readsRefusal({ appDirectory: app, names: billing, reads });

		expect(refusal(["customer"])).toBeUndefined();
		expect(refusal(["vendor"])).toContain("no src/contexts/vendor/");
		expect(refusal(["billing"])).toContain("cannot read itself");
		expect(refusal(["foo"])).toContain("contains foo");
		expect(refusal(["../customer"])).toContain("is not kebab-case");
		expect(refusal(["customer", "customer"])).toContain("twice");
		writeFileSync(ports, "export type CustomerBillingReader = {};\n");
		expect(refusal(["customer"])).toContain("customer already reads billing");
	});

	it("reads back the contexts a context's ports read", () => {
		using folder = appCreate("");
		const app = folder.path;
		mkdirSync(join(app, "src/contexts/billing/application"), {
			recursive: true,
		});
		writeFileSync(
			join(app, "src/contexts/billing/application/ports.ts"),
			'export type BillingReaders = Pick<\n\tBillingPorts,\n\t"billingCustomerReader" | "billingInvoiceLineReader"\n>;\n',
		);

		expect(contextReadsFind({ appDirectory: app, context: "billing" })).toEqual(
			["customer", "invoice-line"],
		);
		expect(contextReadsFind({ appDirectory: app, context: "vendor" })).toEqual(
			[],
		);
	});
});

describe("nextStepsText", () => {
	it("names the codegen step only before a migration exists, and only the parts copied", () => {
		const bare = nextStepsText({
			aggregate: names,
			context: "billing",
			migrated: false,
			parts: ["seed"],
		});
		expect(bare).toContain("pnpm codegen --name invoice_line_create");
		expect(bare).toContain(
			"src/contexts/billing/adapters/inbound/invoice-line-seed.ts",
		);
		expect(bare).not.toContain("Schedule");
		expect(bare).not.toContain("pages");

		const full = nextStepsText({
			aggregate: names,
			context: "billing",
			migrated: true,
			parts: null,
		});
		expect(full).not.toContain("codegen");
		expect(full).toContain("Schedule");
		expect(full).toContain("pages");
	});
});

describe("the aggregate-create command", () => {
	const script = new URL("./aggregate-create.ts", import.meta.url).pathname;
	const command = (...args: string[]) =>
		spawnSync(process.execPath, [script, ...args], {
			cwd: appRoot,
			encoding: "utf8",
		});

	it("prints its usage for --help and -h and exits 0", () => {
		for (const flag of ["--help", "-h"]) {
			const run = command(flag);
			expect(run.status).toBe(0);
			expect(run.stdout).toContain(
				"Usage: pnpm aggregate-create <context> <aggregate>",
			);
			expect(run.stderr).toBe("");
		}
	});

	it("prints its usage and exits 1 on an unknown flag or a missing name, with no stack trace", () => {
		for (const args of [["billing", "invoice-line", "--nope"], ["billing"]]) {
			const run = command(...args);
			expect(run.status).toBe(1);
			expect(run.stderr).toContain("Usage:");
			expect(run.stderr).not.toMatch(/\n\s+at /);
		}
	});

	it("refuses a part flag without --bare", () => {
		const run = command("billing", "invoice-line", "--schedule");
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

// A Project rendered from this template, with the billing context made by context-create, then
// the Aggregates added in order, each written before the next is made.
const projectBuild = ({
	aggregates,
	reads = [],
	removed = [],
}: {
	aggregates: { names: typeof names; parts?: AggregatePart[] | null }[];
	reads?: string[];
	removed?: string[];
}) => {
	const folder = mkdtempDisposableSync(join(tmpdir(), "aggregate-create-"));
	const app = folder.path;
	const templateFull = filesRead(appRoot.pathname);
	filesWrite(
		app,
		templateWithoutPieces(
			templateFilesRender(templateFull, { description: "d", name: "n" }),
			removed,
		),
	);
	if (removed.length > 0) {
		writeFileSync(
			join(app, "package.json"),
			JSON.stringify({ dependencies: {} }),
		);
	}
	for (const target of reads) {
		mkdirSync(join(app, "src/contexts", target, "application"), {
			recursive: true,
		});
		writeFileSync(
			join(app, "src/contexts", target, "application/ports.ts"),
			"",
		);
	}
	const shell = contextFilesCreate({
		appDirectory: app,
		context: "billing",
		reads,
		templateFull,
	});
	filesWrite(app, shell);
	const steps = aggregates.map(({ names: aggregate, parts = null }) => {
		const created = aggregateFilesCreate({
			aggregate,
			appDirectory: app,
			context: "billing",
			parts,
			templateFull,
		});
		filesWrite(app, created);
		return created;
	});
	return { app, folder, shell, steps };
};

const textOf = (files: TemplateFile[], path: string) =>
	files.find((f) => f.path === path)?.text ?? "";

describe.runIf(template)(
	"context-create and aggregate-create on the template",
	() => {
		const built = template
			? projectBuild({ aggregates: [{ names }] })
			: undefined;
		const files = built?.steps[0] ?? [];
		const file = (path: string) => textOf(files, path);

		it("copies Foo and both pages into the context, renamed, and never Bar", () => {
			const paths = files.map((f) => f.path);

			expect(paths).toContain("src/contexts/billing/domain/invoice-line.ts");
			expect(paths).toContain(
				"src/contexts/billing/adapters/inbound/invoice-line-routes.ts",
			);
			expect(paths).toContain(
				"src/contexts/billing/invoice-line-error-status.ts",
			);
			expect(paths).toContain("src/ui/routes/invoice-line-list.tsx");
			expect(paths).toContain("src/ui/routes/invoice-line-detail.tsx");
			expect(paths.filter((p) => /foo|bar/.test(p))).toEqual([]);
			expect(
				files.filter((f) =>
					/\b(foo|Foo)|(?<![A-Za-z])[Bb]ar(?![a-z])/.test(f.text),
				),
			).toEqual([]);
		});

		it("names the context where foo was the context", () => {
			expect(
				file("src/contexts/billing/application/invoice-line-create.ts"),
			).toContain("(ports: BillingPorts)");
			expect(
				file("src/contexts/billing/application/billing-use-cases.ts"),
			).toContain("invoiceLineCreate: invoiceLineCreate(ports),");
			expect(file("src/contexts/billing/application/ports.ts")).toContain(
				"invoiceLineRepository: InvoiceLineRepository;",
			);
		});

		it("refuses to overwrite a file the project already has", () => {
			if (!built) return;
			expect(() =>
				aggregateFilesCreate({
					aggregate: names,
					appDirectory: built.app,
					context: "billing",
					templateFull: filesRead(appRoot.pathname),
				}),
			).toThrow("already exists; move it aside first");
		});

		it("wires no Markdown file, even one that quotes a marker on its own line", () => {
			using project = projectBuild({ aggregates: [] }).folder;
			const created = aggregateFilesCreate({
				aggregate: names,
				appDirectory: project.path,
				context: "billing",
				templateFull: [
					...filesRead(appRoot.pathname),
					{ path: "CHANGELOG.md", text: "\t// wiring: use-cases\n" },
				],
			});

			expect(created.map((f) => f.path)).not.toContain("CHANGELOG.md");
		});

		it("puts the new schedule item at its marker in .env.schema", () => {
			expect(file(".env.schema")).toContain(
				"# @sensitive=false @required=false\nSCHEDULE_INVOICE_LINE_STALE_ARCHIVE=\n# wiring: schedules",
			);
		});

		it("builds the context's use cases in src/use-cases.ts and hands them to each composition root", () => {
			const shell = built?.shell ?? [];
			expect(textOf(shell, "src/use-cases.ts")).toMatch(
				/telemetryUseCasesTrace\(\s*billingUseCasesCreate\(billingPortsCreate\(connections\)\),\s*\);\n\t\/\/ wiring: use-cases\n/,
			);
			expect(textOf(shell, "src/use-cases.ts")).toContain(
				"billingUseCases,\n\t\t// wiring: use-cases-returned",
			);
			expect(file("src/server.ts")).toContain(
				'app.route("/api/v1/invoice-lines", invoiceLineRoutesCreate(useCases.billingUseCases));\n// wiring: routes',
			);
			for (const root of ["src/server.ts", "src/worker.ts", "src/seed.ts"]) {
				expect(file(root)).not.toContain("PortsCreate(");
			}
			expect(file("src/worker.ts")).toContain(
				"invoiceLineScheduleCreate(useCases.billingUseCases),\n\t\t// wiring: schedules",
			);
			expect(file("src/ui/context.ts")).toContain(
				"[billingUseCasesContext, useCases.billingUseCases],",
			);
			expect(file("src/ui/routes.ts")).toContain(
				'route("invoice-lines/:invoiceLineId", "routes/invoice-line-detail.tsx"),',
			);
		});

		it("gives the context's files a second Aggregate's lines beside the first's, and the UI key once", () => {
			using second = projectBuild({
				aggregates: [
					{ names },
					{ names: { kebab: "invoice-note", plural: "invoice-notes" } },
				],
			}).folder;
			const read = (path: string) =>
				filesRead(second.path).find((f) => f.path === path)?.text ?? "";

			const ports = read("src/contexts/billing/application/ports.ts");
			expect(ports).toContain("invoiceLineRepository: InvoiceLineRepository;");
			expect(ports).toContain("invoiceNoteRepository: InvoiceNoteRepository;");
			expect(ports.match(/billingClock: Clock;/g)).toHaveLength(1);
			// drizzle-kit refuses a second exported schema of one name.
			expect(
				read("src/contexts/billing/adapters/outbound/invoice-line-table.ts"),
			).toContain('export const invoiceLineSchema = pgSchema("billing");');
			expect(
				read("src/contexts/billing/adapters/outbound/invoice-note-table.ts"),
			).toMatch(/^const invoiceNoteSchema = pgSchema\("billing"\);$/m);
			const state = read(
				"src/contexts/billing/adapters/outbound/billing-transaction.memory.ts",
			);
			expect(state).toContain(
				"invoiceLines: structuredClone(state.invoiceLines),",
			);
			expect(state).toContain(
				"invoiceNotes: structuredClone(state.invoiceNotes),",
			);
			expect(
				read("src/ui/context.ts").match(/export const billingUseCasesContext/g),
			).toHaveLength(1);
			expect(read("src/server.ts")).toContain(
				'app.route("/api/v1/invoice-notes", invoiceNoteRoutesCreate(useCases.billingUseCases));',
			);
		});

		// One file or line that only each part brings. Imports do not count: the unused-imports pass
		// drops the ones a left-out part leaves behind.
		const importsDrop = (created: TemplateFile[]) =>
			created.map((f) => ({
				path: f.path,
				text: f.text.replaceAll(/^import [\s\S]*?;$/gm, ""),
			}));
		const partSigns: Record<
			AggregatePart,
			(created: TemplateFile[]) => boolean
		> = {
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

		it.each([[], ...aggregateParts.map((part) => [part])] as AggregatePart[][])(
			"brings only the files and lines of the parts named with --bare %j",
			(...parts) => {
				const step = projectBuild({ aggregates: [{ names, parts }] });
				using _folder = step.folder;
				const created = step.steps[0] ?? [];

				expect(
					aggregateParts.filter((p) => partSigns[p](importsDrop(created))),
				).toEqual(parts);
				expect(
					created.filter((f) => /aggregate-create-(start|end)/.test(f.text)),
				).toEqual([]);
			},
		);

		it("copies with --bare and every part what it copies without --bare", () => {
			const step = projectBuild({
				aggregates: [{ names, parts: [...aggregateParts] }],
			});
			using _folder = step.folder;

			expect(step.steps[0]).toEqual(files);
		});

		it("writes the reader, its fake, the Bridge and its wiring for --reads, and passes the readers to a later Aggregate's tests", () => {
			const step = projectBuild({
				aggregates: [{ names, parts: [] }],
				reads: ["customer"],
			});
			using _folder = step.folder;
			const shell = (path: string) => textOf(step.shell, path);

			expect(shell("src/contexts/billing/application/ports.ts")).toContain(
				'export type BillingReaders = Pick<BillingPorts, "billingCustomerReader">;',
			);
			expect(
				shell("src/contexts/billing/adapters/outbound/index.ts"),
			).toContain("\treaders: BillingReaders,\n): BillingPorts =>");
			expect(
				shell("src/contexts/billing/adapters/outbound/index.ts"),
			).toContain(
				'export { billingCustomerReaderMemoryCreate } from "./billing-customer-reader.memory.ts";',
			);
			expect(shell("src/bridges/billing-customer-reader.ts")).toContain(
				'id: "billing-customer-reader"',
			);
			expect(shell("src/use-cases.ts")).toContain(
				"billingCustomerReader: billingCustomerReaderCreate(customerUseCases)",
			);
			expect(
				textOf(
					step.steps[0] ?? [],
					"src/contexts/billing/adapters/outbound/index-invoice-line.test.ts",
				),
			).toContain(
				"{ billingCustomerReader: billingCustomerReaderMemoryCreate() })",
			);
			// Every call of the ports factory passes the readers, so none is left with one argument.
			expect(
				[...step.shell, ...(step.steps[0] ?? [])].filter((f) =>
					/billingPortsCreate\((connections|\{[^}]*\})\)/.test(f.text),
				),
			).toEqual([]);
		});

		it("fills a first --bare Aggregate's wiring only for its parts, and a later one's for the parts it brings", () => {
			const step = projectBuild({
				aggregates: [
					{ names, parts: [] },
					{
						names: { kebab: "invoice-note", plural: "invoice-notes" },
						parts: ["pages", "schedule", "seed"],
					},
				],
			});
			using _folder = step.folder;
			const [first = [], later = []] = step.steps;

			expect(textOf(step.shell, "src/server.ts")).toContain(
				"const useCases = domainsUseCasesCreate(connections);",
			);
			expect(textOf(first, "src/server.ts")).not.toContain(
				"seedsRun(useCases)",
			);
			expect(textOf(first, "src/server.ts")).not.toMatch(/^\s*useCases,$/m);
			expect(textOf(first, "src/seed.ts")).not.toContain("devSeedActor");
			expect(textOf(first, "src/worker.ts")).not.toContain(
				"domainsUseCasesCreate(",
			);
			expect(first.map((f) => f.path)).not.toContain("src/ui/routes/home.tsx");

			expect(textOf(later, "src/server.ts")).toContain("seedsRun(useCases)");
			expect(textOf(later, "src/server.ts")).toMatch(/^\s*useCases,$/m);
			expect(textOf(later, "src/seed.ts")).toContain("...invoiceNoteScopes");
			expect(textOf(later, "src/worker.ts")).toContain(
				"const useCases = domainsUseCasesCreate(connections);",
			);
			expect(textOf(later, "src/ui/context.ts")).toContain(
				"useCases: DomainsUseCases",
			);
			expect(textOf(later, "src/ui/routes.ts")).toContain(
				'index("routes/home.tsx")',
			);
			expect(later.map((f) => f.path)).toContain("src/ui/routes/home.tsx");
		});

		it("leaves foo's files alone when it reads nothing", () => {
			const files = filesRead(appRoot.pathname);

			expect(readsApply({ files, reads: [] })).toBe(files);
		});

		it("counts redis as removed once its package is gone", () => {
			using folder = appCreate("**Invoice line**:\nA line.\n");
			writeFileSync(
				join(folder.path, "package.json"),
				JSON.stringify({ dependencies: { "@n8io/baseline-cache": "1" } }),
			);
			expect(piecesRemovedFind(folder.path)).toContain("redis");
			expect(piecesRemovedFind(folder.path)).not.toContain("cache");
		});

		it("leaves out the pieces a Project removed, which have no package left", () => {
			const step = projectBuild({
				aggregates: [{ names }],
				removed: [
					"analytics",
					"api-reference",
					"cache",
					"error-tracking",
					"live",
					"queue",
					"redis",
					"ui",
				],
			});
			using _folder = step.folder;
			const created = [...step.shell, ...(step.steps[0] ?? [])];
			const paths = created.map((f) => f.path);

			expect(paths).toContain("src/contexts/billing/application/ports.ts");
			expect(
				paths.filter((p) =>
					/^src\/(ui\/|worker\.ts)|-analytics\.|-live\.|-cached?\.|-schedule\.|-transaction\.postgres\.test|-queue\.test/.test(
						p,
					),
				),
			).toEqual([]);
			expect(
				created.filter((f) =>
					/piece-(start|end): (analytics|api-reference|cache|error-tracking|live|queue|redis|ui)|SCHEDULE_|Analytics/.test(
						f.text,
					),
				),
			).toEqual([]);
			const server = textOf(step.steps[0] ?? [], "src/server.ts");
			expect(server).toContain(
				"invoiceLineRoutesCreate(useCases.billingUseCases)",
			);
			// The import stays for the unused-imports pass to remove.
			expect(server).not.toContain("invoiceLineLiveRoutesCreate(");
		});
	},
);

describe("fooRename", () => {
	it("is what the two-name rename falls back to for a context file", () => {
		expect(
			fooRename({ names: billing, path: "x.ts", text: "fooPortsCreate" }),
		).toBe("billingPortsCreate");
	});
});
