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
import { contextFilesCreate } from "./context-create.ts";
import {
	aclPath,
	contextModelRename,
	contextReadsFind,
	contextsPairsFill,
	lineIsBar,
	lineIsModel,
	type ModelOption,
	modelFilesCreate,
	modelNextStepsText,
	modelOptions,
	modelRefusal,
	nameRefusal,
	nameTerm,
	readsApply,
	readsRefusal,
	templateWithoutPieces,
	wiringInsert,
} from "./model-create.ts";
import { type Piece, pieceBlocksRemove, piecesRemovedFind } from "./pieces.ts";
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
	const folder = mkdtempDisposableSync(join(tmpdir(), "model-create-"));
	const directory = folder.path;
	// The billing context's own glossary, which model-create reads its Models' terms from.
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

describe("nameRefusal and modelRefusal", () => {
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
			modelRefusal({
				model: names,
				appDirectory: app,
				context: "billing",
			}),
		).toBeUndefined();
	});

	it.each([
		[{ kebab: "InvoiceLine", plural: "invoice-lines" }, "not kebab-case"],
		[{ kebab: "invoice-line", plural: "invoice_lines" }, "not kebab-case"],
		[{ kebab: "foo-thing", plural: "foo-things" }, "example name"],
		[{ kebab: "sheep", plural: "sheep" }, "must differ"],
		[{ kebab: "doc", plural: "docs" }, "API reference"],
		[{ kebab: "customer", plural: "customers" }, "no **Customer**: entry"],
	])("refuses the Model %j", (refused, reason) => {
		using folder = appCreate("**Invoice line**:\nOne line.\n**Sheep**:\nA.\n");
		const app = folder.path;
		mkdirSync(join(app, "src/contexts/billing"), { recursive: true });
		writeFileSync(join(app, "src/contexts/billing/index.ts"), "");

		expect(
			modelRefusal({
				model: refused,
				appDirectory: app,
				context: "billing",
			}),
		).toContain(reason);
	});

	it("refuses a context that does not exist, and a Model it already holds", () => {
		using folder = appCreate("**Invoice line**:\nOne line.\n");
		const app = folder.path;
		const refusal = () =>
			modelRefusal({
				model: names,
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
			modelRefusal({ model: names, appDirectory: app, context: "crm" });
		writeFileSync(join(app, "src/contexts/crm/index.ts"), "");
		expect(crm()).toContain(
			"src/contexts/billing/domain/invoice-line.ts already exists",
		);
		expect(
			modelRefusal({
				model: { kebab: "billing", plural: "billings" },
				appDirectory: app,
				context: "crm",
			}),
		).toContain("src/contexts/billing/ is another context");
	});
});

describe("contextModelRename", () => {
	it("spells the context where foo is the context and the Model everywhere else", () => {
		const text = [
			'import type { FooPorts } from "../application/ports.ts";',
			'import { fooPortsMemoryCreate } from "../adapters/outbound/foo-ports.memory.ts";',
			'import { fooCanDelete } from "#contexts/foo/domain/foo.ts";',
			"export const fooDelete = (ports: FooPorts) => ports.fooTransaction(async (t) => t.fooRepository);",
			'const key = "foo.deleted";',
			'export const fooSchema = pgSchema("foo");',
		].join("\n");

		expect(
			contextModelRename({
				model: names,
				context: billing,
				path: "src/contexts/foo/application/foo-delete.ts",
				text,
			}).split("\n"),
		).toEqual([
			'import type { BillingPorts } from "../application/ports.ts";',
			'import { billingPortsMemoryCreate } from "../adapters/outbound/billing-ports.memory.ts";',
			'import { invoiceLineCanDelete } from "#contexts/billing/domain/invoice-line.ts";',
			"export const invoiceLineDelete = (ports: BillingPorts) => ports.billingTransaction(async (t) => t.invoiceLineRepository);",
			'const key = "invoice-line.deleted";',
			'export const invoiceLineSchema = pgSchema("billing");',
		]);
	});

	it("tells a line of the Model from a line of the context, and finds Bar's", () => {
		expect(lineIsModel("\tfooClock: Clock;")).toBe(false);
		expect(
			lineIsModel("\tfooTransaction: fooTransactionMemoryCreate(state),"),
		).toBe(false);
		expect(lineIsModel("\tfooReadRepository: FooReadRepository;")).toBe(true);
		expect(
			lineIsModel(
				'app.route("/api/v1/foos", fooRoutesCreate(useCases.fooUseCases));',
			),
		).toBe(true);
		expect(lineIsBar("\tbarRepository: BarRepository;")).toBe(true);
		expect(lineIsBar("// a toolbar and a barrier")).toBe(false);
		expect(lineIsBar('\tscopes: ["bar:read"],')).toBe(false);
		expect(lineIsBar('<nav className="nav-bar">')).toBe(false);
		expect(lineIsBar('\tbars: new Map<Id<"bar">, Bar>(),')).toBe(true);
		expect(lineIsBar('export * from "./domain/bar.ts";')).toBe(true);
		expect(lineIsBar("\t// invariant: a Bar never outlives its Foo.")).toBe(
			true,
		);
	});
});

describe("wiringInsert", () => {
	const rename = (text: string) =>
		contextModelRename({
			model: names,
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
			blockIs: lineIsModel,
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
				blockIs: lineIsModel,
				path: "src/server.ts",
				project: inserted,
				rename,
				template: templateText,
			}),
		).toBe(inserted);
	});

	it("adds a line whose text sits inside a longer name, and skips one Biome reflowed", () => {
		const order = (text: string) =>
			contextModelRename({
				model: { kebab: "order", plural: "orders" },
				context: { kebab: "order", plural: "orders" },
				path: "src/contexts.ts",
				text,
			});
		const insert = (project: string, template: string) =>
			wiringInsert({
				blockIs: (line) => line.includes("foo"),
				path: "src/contexts.ts",
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
				blockIs: lineIsModel,
				path: "src/server.ts",
				project: 'import { ENV } from "#env";\n',
				rename,
				template: templateText,
			}),
		).toThrow('src/server.ts: missing marker "// wiring: routes"');
	});

	it("adds no line at a marker of an option the Model leaves out", () => {
		const template = [
			'import { fooScopes } from "#contexts/foo/index.ts";',
			"",
			"\t...fooScopes,",
			"// wiring: scopes",
		].join("\n");

		expect(
			wiringInsert({
				blockIs: lineIsModel,
				optionsLeftOut: ["seed"],
				path: "src/seed.ts",
				project: "// wiring: scopes",
				rename,
				template,
			}).split("\n"),
		).toEqual([
			'import { invoiceLineScopes } from "#contexts/billing/index.ts";',
			"// wiring: scopes",
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
				blockIs: lineIsModel,
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
				pairWanted: (option) => option === undefined,
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
		mkdirSync(join(app, "src/contexts/customer/adapters/outbound"), {
			recursive: true,
		});
		writeFileSync(join(app, "src/contexts/customer/index.ts"), "");
		const refusal = (reads: string[]) =>
			readsRefusal({ appDirectory: app, names: billing, reads });

		expect(refusal(["customer"])).toBeUndefined();
		expect(refusal(["vendor"])).toContain("no src/contexts/vendor/");
		expect(refusal(["billing"])).toContain("cannot read itself");
		expect(refusal(["foo"])).toContain("example name");
		expect(refusal(["food"])).toContain("no src/contexts/food/");
		expect(refusal(["../customer"])).toContain("is not kebab-case");
		expect(refusal(["customer", "customer"])).toContain("twice");
		writeFileSync(
			join(app, aclPath({ context: "customer", upstream: "billing" })),
			"",
		);
		expect(refusal(["customer"])).toContain("customer already reads billing");
	});

	it("reads back the contexts a context reads from its ACL files", () => {
		using folder = appCreate("");
		const app = folder.path;
		const outbound = join(app, "src/contexts/billing/adapters/outbound");
		mkdirSync(outbound, { recursive: true });
		for (const name of [
			"billing-invoice-line-acl.ts",
			"billing-customer-acl.ts",
			"billing-customer-acl.test.ts",
			"billing-repository.memory.ts",
		]) {
			writeFileSync(join(outbound, name), "");
		}

		expect(contextReadsFind({ appDirectory: app, context: "billing" })).toEqual(
			["customer", "invoice-line"],
		);
		expect(contextReadsFind({ appDirectory: app, context: "vendor" })).toEqual(
			[],
		);
	});
});

describe("modelNextStepsText", () => {
	it("names the codegen step only before a migration exists, and only the options copied", () => {
		const bare = modelNextStepsText({
			model: names,
			context: "billing",
			migrated: false,
			options: ["seed"],
		});
		expect(bare).toContain("pnpm codegen --name invoice_line_create");
		expect(bare).toContain(
			"src/contexts/billing/adapters/inbound/invoice-line-seed.ts",
		);
		expect(bare).not.toContain("Schedule");
		expect(bare).not.toContain("pages");

		const full = modelNextStepsText({
			model: names,
			context: "billing",
			migrated: true,
			options: null,
		});
		expect(full).not.toContain("codegen");
		expect(full).toContain("Schedule");
		expect(full).toContain("pages");
	});
});

describe("the model-create command", () => {
	const script = new URL("./model-create.ts", import.meta.url).pathname;
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
				"Usage: pnpm model-create <context> <model>",
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

	it("refuses an option flag without --bare", () => {
		const run = command("billing", "invoice-line", "--schedule");
		expect(run.status).toBe(1);
		expect(run.stderr).toContain("--schedule picks options for --bare");
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
// the Models added in order, each written before the next is made.
const projectBuild = ({
	models,
	reads = [],
	removed = [],
}: {
	models: { names: typeof names; options?: ModelOption[] | null }[];
	reads?: string[];
	removed?: Piece[];
}) => {
	const folder = mkdtempDisposableSync(join(tmpdir(), "model-create-"));
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
		mkdirSync(join(app, "src/contexts", target), { recursive: true });
		writeFileSync(join(app, "src/contexts", target, "index.ts"), "");
	}
	const shell = contextFilesCreate({
		appDirectory: app,
		context: "billing",
		reads,
		templateFull,
	});
	filesWrite(app, shell);
	const steps = models.map(({ names: model, options = null }) => {
		const created = modelFilesCreate({
			model,
			appDirectory: app,
			context: "billing",
			options,
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
	"context-create and model-create on the template",
	() => {
		const built = template ? projectBuild({ models: [{ names }] }) : undefined;
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
				modelFilesCreate({
					model: names,
					appDirectory: built.app,
					context: "billing",
					templateFull: filesRead(appRoot.pathname),
				}),
			).toThrow("already exists; move it aside first");
		});

		it("wires no Markdown file, even one that quotes a marker on its own line", () => {
			using project = projectBuild({ models: [] }).folder;
			const created = modelFilesCreate({
				model: names,
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

		it("builds the context in src/contexts.ts, with each Model's routes, schedules and seeds in its index.ts", () => {
			const shell = built?.shell ?? [];
			expect(textOf(shell, "src/contexts/billing/index.ts")).toMatch(
				/telemetryUseCasesTrace\(\s*billingUseCasesCreate\(billingPortsCreate\(connections\)\),\s*\);/,
			);
			expect(textOf(shell, "src/contexts.ts")).toContain(
				"const billingContext = billingContextCreate({ connections });\n\t// wiring: contexts\n",
			);
			expect(textOf(shell, "src/contexts.ts")).toContain(
				"billingContext,\n\t\t// wiring: contexts-returned",
			);
			const index = file("src/contexts/billing/index.ts");
			expect(index).toContain(
				'{ path: "/api/v1/invoice-lines", router: invoiceLineRoutesCreate(useCases) },',
			);
			expect(index).toContain(
				"invoiceLineScheduleCreate(useCases),\n\t\t\t// wiring: schedules",
			);
			expect(index).toContain(
				"(actor: Actor) => invoiceLineSeed(useCases, actor),\n\t\t\t// wiring: seeds",
			);
			expect(index).toContain(
				"\tinvoiceLineSchedule,\n\t// wiring: schedule-definitions",
			);
			expect(file("src/migrate.ts")).not.toContain("invoiceLineSchedule");
			expect(textOf(shell, "src/migrate.ts")).toContain(
				"...billingSchedules,\n\t\t// wiring: schedules",
			);
			for (const root of ["src/server.ts", "src/worker.ts", "src/seed.ts"]) {
				expect(file(root)).not.toContain("PortsCreate(");
				expect(file(root)).not.toContain("#contexts/billing/adapters/");
			}
			expect(file("src/ui/context.ts")).toContain(
				"[billingUseCasesContext, contexts.billingContext.useCases],",
			);
			expect(file("src/ui/routes.ts")).toContain(
				'route("invoice-lines/:invoiceLineId", "routes/invoice-line-detail.tsx"),',
			);
		});

		it("gives the context's files a second Model's lines beside the first's, and the UI key once", () => {
			using second = projectBuild({
				models: [
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
			const index = read("src/contexts/billing/index.ts");
			expect(index).toContain("router: invoiceLineRoutesCreate(useCases)");
			expect(index).toContain("router: invoiceNoteRoutesCreate(useCases)");
			expect(index.match(/billingContextCreate = /g)).toHaveLength(1);
		});

		// One file or line that only each option brings. Imports do not count: the unused-imports pass
		// drops the ones a left-out option leaves behind.
		const importsDrop = (created: TemplateFile[]) =>
			created.map((f) => ({
				path: f.path,
				text: f.text.replaceAll(/^import [\s\S]*?;$/gm, ""),
			}));
		const optionSigns: Record<
			ModelOption,
			(created: TemplateFile[]) => boolean
		> = {
			analytics: (created) =>
				created.some((f) => f.text.includes("invoiceLineAnalytics")),
			cache: (created) =>
				created.some((f) => f.path.endsWith("/invoice-line-cached.ts")),
			live: (created) =>
				created.some(
					(f) =>
						f.path.endsWith("/invoice-line-live-routes.ts") ||
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
						/StaleArchive|archiveStale|StaleBefore|STALE_DAYS|INVOICE_LINE_STALE_ARCHIVE|invoiceLineSchedule/.test(
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

		it.each([[], ...modelOptions.map((option) => [option])] as ModelOption[][])(
			"brings only the files and lines of the options named with --bare %j",
			(...options) => {
				const step = projectBuild({ models: [{ names, options }] });
				using _folder = step.folder;
				const created = step.steps[0] ?? [];

				expect(
					modelOptions.filter((p) => optionSigns[p](importsDrop(created))),
				).toEqual(options);
				expect(
					created.filter((f) => /model-create-(start|end)/.test(f.text)),
				).toEqual([]);
			},
		);

		it("copies with --bare and every option what it copies without --bare", () => {
			const step = projectBuild({
				models: [{ names, options: [...modelOptions] }],
			});
			using _folder = step.folder;

			expect(step.steps[0]).toEqual(files);
		});

		it("writes the ACL, its test and its wiring for --reads, and passes the upstream to a later Model's tests", () => {
			const step = projectBuild({
				models: [{ names, options: [] }],
				reads: ["customer"],
			});
			using _folder = step.folder;
			const shell = (path: string) => textOf(step.shell, path);
			const outbound = "src/contexts/billing/adapters/outbound";

			expect(shell("src/contexts/billing/application/ports.ts")).toContain(
				"\tbillingCustomerAcl: BillingCustomerAcl;\n",
			);
			expect(shell(`${outbound}/index.ts`)).toContain(
				"\tupstream: BillingUpstream,\n): BillingPorts =>",
			);
			expect(shell(`${outbound}/index.ts`)).toContain(
				"export type BillingUpstream = { customer: BillingCustomerUpstream };",
			);
			expect(shell(`${outbound}/index.ts`)).toContain(
				"billingCustomerAcl: billingCustomerAclCreate(upstream.customer),",
			);
			expect(shell(`${outbound}/billing-ports.memory.ts`)).toContain(
				"export const billingPortsMemoryCreate = (upstream: BillingUpstream) => {",
			);
			expect(shell(`${outbound}/billing-customer-acl.ts`)).toContain(
				'import type { CustomerContext } from "#contexts/customer/index.ts";',
			);
			expect(shell(`${outbound}/billing-customer-acl.ts`)).toContain(
				'id: "billing-customer-acl"',
			);
			expect(shell(`${outbound}/billing-customer-acl.test.ts`)).toContain(
				"billingCustomerAclCreate(customer)",
			);
			expect(shell(`${outbound}/billing-test-upstream.ts`)).toContain(
				"return { customer: contexts.customerContext };",
			);
			expect(shell("src/contexts.ts")).toMatch(
				/upstream: \{\s*\/\/ Built after customer: it reads customer through an ACL\.\s*customer: customerContext\s*\}/,
			);
			expect(shell("src/contexts/billing/index.ts")).toContain(
				"\tupstream: BillingUpstream;\n",
			);
			expect(shell("src/contexts/billing/index.ts")).toContain(
				"billingPortsCreate(connections, upstream)",
			);
			expect(step.shell.map((f) => f.path)).not.toContainEqual(
				expect.stringMatching(/^src\/bridges\//),
			);
			const later = textOf(
				step.steps[0] ?? [],
				`${outbound}/invoice-line-repository.memory.test.ts`,
			);
			expect(later).toContain(
				"const upstream = await billingTestUpstreamCreate();",
			);
			expect(later).toContain("billingPortsMemoryCreate(upstream)");
			// Every call of the ports factories passes the upstream, so none is left without it.
			expect(
				[...step.shell, ...(step.steps[0] ?? [])].filter(
					(f) =>
						/billingPortsCreate\((connections|\{[^}]*\})\)/.test(f.text) ||
						f.text.includes("billingPortsMemoryCreate()"),
				),
			).toEqual([]);
		});

		it("fills a first --bare Model's wiring only for its options, and a later one's for the options it brings", () => {
			const step = projectBuild({
				models: [
					{ names, options: [] },
					{
						names: { kebab: "invoice-note", plural: "invoice-notes" },
						options: ["pages", "schedule", "seed"],
					},
				],
			});
			using _folder = step.folder;
			const [first = [], later = []] = step.steps;

			expect(textOf(step.shell, "src/server.ts")).toContain(
				"const contexts = contextsCreate(connections);",
			);
			expect(textOf(step.shell, "src/worker.ts")).toContain(
				"...Object.values(contextsCreate(connections)),",
			);
			expect(textOf(first, "src/server.ts")).not.toMatch(/^\s*contexts,$/m);
			expect(textOf(first, "src/seed.ts")).not.toContain(
				"...invoiceLineScopes",
			);
			// Imports aside: the unused-imports pass drops them.
			expect(textOf(first, "src/contexts/billing/index.ts")).not.toMatch(
				/invoiceLineSeed\(|invoiceLineScheduleCreate\(|^\s*invoiceLineSchedule,/m,
			);
			expect(first.map((f) => f.path)).not.toContain("src/ui/routes/home.tsx");

			expect(textOf(later, "src/server.ts")).toMatch(/^\s*contexts,$/m);
			expect(textOf(later, "src/seed.ts")).toContain("...invoiceNoteScopes");
			expect(textOf(later, "src/contexts/billing/index.ts")).toContain(
				"invoiceNoteScheduleCreate(useCases),",
			);
			expect(textOf(later, "src/ui/context.ts")).toContain(
				"contexts: Contexts",
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

		it("counts the cli as removed once its folder has no package.json", () => {
			using folder = appCreate("**Invoice line**:\nA line.\n");
			writeFileSync(
				join(folder.path, "package.json"),
				JSON.stringify({ devDependencies: { orval: "1" } }),
			);
			expect(piecesRemovedFind(folder.path)).toContain("cli");
			expect(piecesRemovedFind(folder.path)).not.toContain("sdk");
			mkdirSync(join(folder.path, "clients/cli"), { recursive: true });
			writeFileSync(join(folder.path, "clients/cli/package.json"), "{}");
			expect(piecesRemovedFind(folder.path)).not.toContain("cli");
		});

		it("leaves out the pieces a Project removed, which have no package left", () => {
			const step = projectBuild({
				models: [{ names }],
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
					/^src\/(ui\/|worker\.ts)|-analytics\.|-live(-routes)?\.|-cached?\.|-schedule\.|-transaction\.postgres\.test|-queue\.test/.test(
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
			const index = textOf(
				step.steps[0] ?? [],
				"src/contexts/billing/index.ts",
			);
			expect(index).toContain("router: invoiceLineRoutesCreate(useCases)");
			// The import stays for the unused-imports pass to remove.
			expect(index).not.toContain("invoiceLineLiveRoutesCreate(");
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
