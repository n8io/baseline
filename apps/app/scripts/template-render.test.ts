import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempDisposableSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { domainsPairsFill } from "./domain-create.ts";
import {
	clientManifestPin,
	domainsPairsFind,
	filesRead,
	fooBlocksFind,
	fooLineIs,
	fooPathRename,
	fooRename,
	hostPortsCreate,
	linesRemove,
	lockfileRender,
	readmeRender,
	run,
	templateFileRender,
	templateFilesRender,
	templateFinish,
	workspaceRender,
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
import.meta.glob(["../AGENTS.md", "../CONTEXT.md", "../docs/**"], {
	query: "?raw",
});

const appRoot = new URL("../", import.meta.url);
const names = { kebab: "invoice-line", plural: "invoice-lines" };
const answers = { description: "Invoices for small shops.", name: "invoicing" };
const domainsUrl = new URL("src/contexts/", appRoot);
// The template itself: foo is its only domain. A project, or this tree after a
// domain-create, skips these tests.
const template =
	existsSync(domainsUrl) &&
	readdirSync(domainsUrl)
		.filter((name) => !name.startsWith("."))
		.join() === "foo";

describe("run", () => {
	it("keeps a working command's stderr out of the terminal", () => {
		const module = new URL("./template-render.ts", import.meta.url).pathname;
		const child = spawnSync(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				`import { run } from ${JSON.stringify(module)};
run({ command: process.execPath, args: ["-e", "process.stderr.write('error: could not apply')"] });`,
			],
			{ encoding: "utf8" },
		);

		expect(child.status).toBe(0);
		expect(child.stderr).toBe("");
	});

	it("puts a failing command's stderr in its error", () => {
		expect(() =>
			run({
				command: process.execPath,
				args: ["-e", "process.stderr.write('it broke'); process.exit(3)"],
			}),
		).toThrow("it broke");
	});
});

describe("fooRename", () => {
	it("spells each occurrence the way its place needs", () => {
		const source = [
			'import { fooCreate } from "#contexts/foo/application/foo-create.ts";',
			'const foo = idCreate("foo"); // Saves the foo.',
			"const foos: Foo[] = state.foos;",
			'span.setAttribute("baseline.foo.id", foo.id);',
			'publish({ name: "foo.created", key: fooId }); scope("foo:update");',
			`redirect(\`/foos/\${foo.id}\`); app.route("/live/foo", r);`,
			"process.env.SCHEDULE_FOO_STALE_ARCHIVE; /^foo_/;",
			`throw new Error(\`Foo \${id} not found\`); "foos"; "FooNotFound";`,
			'operationId: "fooGet", tags: ["foo"],',
		].join("\n");

		expect(
			fooRename({ text: source, names, path: "src/x.ts" }).split("\n"),
		).toEqual([
			'import { invoiceLineCreate } from "#contexts/invoice-line/application/invoice-line-create.ts";',
			'const invoiceLine = idCreate("invoice_line"); // Saves the invoice line.',
			"const invoiceLines: InvoiceLine[] = state.invoiceLines;",
			'span.setAttribute("baseline.invoice_line.id", invoiceLine.id);',
			'publish({ name: "invoice-line.created", key: invoiceLineId }); scope("invoice-line:update");',
			`redirect(\`/invoice-lines/\${invoiceLine.id}\`); app.route("/live/invoice_line", r);`,
			"process.env.SCHEDULE_INVOICE_LINE_STALE_ARCHIVE; /^invoice_line_/;",
			`throw new Error(\`Invoice line \${id} not found\`); "invoice-lines"; "InvoiceLineNotFound";`,
			'operationId: "invoiceLineGet", tags: ["invoiceLine"],',
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

		expect(
			fooRename({ text: source, names, path: "src/ui/routes/x.tsx" }).split(
				"\n",
			),
		).toEqual([
			"<h1>Invoice lines</h1>",
			"<CardTitle>New invoice line</CardTitle>",
			"\t\t\t\tBack to invoice lines",
			"<p>Delete this invoice line?</p>",
			"{invoiceLine.name} {items.map((invoiceLine) => invoiceLine.id)}",
			"<p>Invoice lines</p> {invoiceLine.name}",
			'"A invoice line named it already exists"',
		]);
	});

	it("renames paths", () => {
		expect(
			fooPathRename(
				"src/contexts/foo/adapters/outbound/foo-ports.memory.ts",
				names,
			),
		).toBe(
			"src/contexts/invoice-line/adapters/outbound/invoice-line-ports.memory.ts",
		);
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
			'} from "#contexts/foo/index.ts";',
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
			"const baz = 2;", // 16
			"app.route(", // 17: every argument names foo, so the call goes too
			'\t"/live/foo",',
			"\tfooLiveRoutesCreate(useCases.fooUseCases, liveHub),",
			");",
		].join("\n");

		expect(fooBlocksFind(text, "src/server.ts")).toEqual([
			[0, 3],
			[5, 7],
			[9, 9],
			[12, 15],
			[17, 20],
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

describe("readmeRender", () => {
	const text =
		"# app\n\n**A starter app.**\n\n<sub>The Template.</sub>\n\n## Start\n\n<sub>Kept.</sub>\n";

	it("names the Project, its description and the release it was made from", () => {
		expect(readmeRender({ answers, release: "10.2.0", text })).toBe(
			"# invoicing\n\n**Invoices for small shops.**\n\n<sub>Made from [baseline](https://github.com/n8io/baseline) [app@10.2.0](https://github.com/n8io/baseline/blob/app%4010.2.0/apps/app/CHANGELOG.md). `pnpm template-upgrade` takes a newer release.</sub>\n\n## Start\n\n<sub>Kept.</sub>\n",
		);
	});

	it("refuses a README it cannot render and a release with no version", () => {
		for (const broken of [
			text.replace("# app", "# other"),
			text.replace("**A starter app.**", "A starter app."),
			text.replaceAll("<sub>", ""),
		]) {
			expect(() =>
				readmeRender({ answers, release: "10.2.0", text: broken }),
			).toThrow("README.md: needs");
		}
		expect(() => readmeRender({ answers, release: "", text })).toThrow(
			"package.json has no version",
		);
	});
});

describe("templateFilesRender", () => {
	const readme = {
		path: "README.md",
		text: "# app\n\n**A starter app.**\n\n<sub>The Template.</sub>\n",
	};

	it("refuses a README.md beside a package.json with no version", () => {
		expect(() =>
			templateFilesRender(
				[readme, { path: "package.json", text: '{ "name": "app" }' }],
				answers,
			),
		).toThrow("package.json has no version");
	});

	it("renders a release that has no README.md", () => {
		expect(
			templateFilesRender([{ path: "src/a.ts", text: "a\n" }], answers).map(
				(f) => f.path,
			),
		).toEqual(["src/a.ts", "src/contexts/.gitkeep"]);
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
			"src/contexts/foo/index.ts",
			"src/ui/routes/foo-list.tsx",
			"src/ui/routes/foo-list.test.ts",
			"src/ui/routes/home.tsx",
			"src/ui/routes/home.test.ts",
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

	it("renders the SDK as pnpm sdk-generate writes it for a Project with no Domain", () => {
		const render = (path: string, text: string) =>
			templateFileRender({ path: `clients/sdk/${path}`, text }, answers)?.text;
		const document = {
			components: {
				schemas: { FooResponse: {}, Problem: {} },
				securitySchemes: { bearer: {} },
			},
			info: { title: "app", version: "1" },
			paths: { "/api/v1/foos": {}, "/api/v1/foos/{fooId}": {} },
		};

		expect(
			JSON.parse(render("package.json", '{ "name": "app-sdk" }') ?? ""),
		).toEqual({ name: "invoicing-sdk" });
		expect(
			JSON.parse(render("openapi.json", JSON.stringify(document)) ?? ""),
		).toEqual({
			components: { schemas: { Problem: {} }, securitySchemes: { bearer: {} } },
			info: { title: "invoicing", version: "1" },
			paths: {},
		});
		expect(
			render(
				"sdk.ts",
				'/**\n * Generated.\n */\nimport { sdkFetch } from "./sdk-fetch.ts";\nexport const fooGet = 1;\n',
			),
		).toBe("/**\n * Generated.\n */\n\n");
	});

	it("names the CLI, its command and its SDK after the Project", () => {
		const render = (path: string, text: string) =>
			templateFileRender({ path: `clients/cli/${path}`, text }, answers)?.text;
		const manifest = {
			name: "app-cli",
			bin: { app: "./cli.ts" },
			dependencies: {
				"@n8io/baseline-cli": "^1.0.0",
				"app-sdk": "workspace:*",
			},
		};

		expect(
			JSON.parse(render("package.json", JSON.stringify(manifest)) ?? ""),
		).toEqual({
			name: "invoicing-cli",
			bin: { invoicing: "./cli.ts" },
			dependencies: {
				"@n8io/baseline-cli": "^1.0.0",
				"invoicing-sdk": "workspace:*",
			},
		});
		expect(
			render(
				"cli.ts",
				'import * as sdk from "app-sdk";\nimport d from "app-sdk/openapi.json";\n',
			),
		).toBe(
			'import * as sdk from "invoicing-sdk";\nimport d from "invoicing-sdk/openapi.json";\n',
		);
	});
});

describe("clientManifestPin", () => {
	it("gives our own workspace packages the caret range pnpm pack writes, and leaves the rest", () => {
		const manifest = JSON.stringify({
			dependencies: {
				"@n8io/baseline-cli": "workspace:^",
				"app-sdk": "workspace:*",
				commander: "^15.1.0",
			},
		});
		expect(
			JSON.parse(
				clientManifestPin(manifest, { "@n8io/baseline-cli": "1.2.0" }),
			),
		).toEqual({
			dependencies: {
				"@n8io/baseline-cli": "^1.2.0",
				"app-sdk": "workspace:*",
				commander: "^15.1.0",
			},
		});
		expect(() => clientManifestPin(manifest, {})).toThrow(
			"no package is @n8io/baseline-cli",
		);
	});
});

describe("workspaceRender", () => {
	it("lists the root and clients/* in place of the monorepo's packages, inside the sdk piece", () => {
		expect(
			workspaceRender(
				"packages:\n  - apps/*\n  - apps/app/clients/*\n  - packages/*\nautoInstallPeers: false\n",
			),
		).toBe(
			'# piece-start: sdk\n# The root is the app; clients/ holds the packages made from its API.\npackages:\n  - "."\n  - clients/*\n# `pnpm add` in the root adds to the app, as in a Project without clients.\nignoreWorkspaceRootCheck: true\n# piece-end: sdk\nautoInstallPeers: false\n',
		);
	});
});

describe("hostPortsCreate and the files it renders into", () => {
	const schema =
		"HEALTH_PORT=9000\nPOSTGRES_HOST_PORT=5432\nREDIS_HOST_PORT=6379\nSERVER_HOST_PORT=3000\nHEALTH_HOST_PORT=9000\n";
	const compose =
		"name: app\nservices:\n  # varlock run -- docker compose -p app up\n";

	it("gives each name seven ports in a row in 20000 to 29999, the same ones every time", () => {
		const ports = hostPortsCreate("invoicing");
		const values = Object.values(ports);

		expect(hostPortsCreate("invoicing")).toEqual(ports);
		expect(values.every((port) => port >= 20_000 && port < 30_000)).toBe(true);
		expect(values.map((port) => port - (values[0] ?? 0))).toEqual([
			0, 1, 2, 3, 4, 5, 6,
		]);
	});

	it("gives two Projects with different names ports that do not overlap", () => {
		const alpha = Object.values(hostPortsCreate("alpha"));
		const beta = Object.values(hostPortsCreate("beta"));

		expect(alpha.filter((port) => beta.includes(port))).toEqual([]);
	});

	it("writes a Project's ports, compose project and -p into its files, keeping production's PORT and HEALTH_PORT", () => {
		const ports = hostPortsCreate("invoicing");
		const render = (path: string, text: string) =>
			templateFileRender({ path, text }, answers)?.text;

		expect(render(".env.schema", schema)).toBe(
			`HEALTH_PORT=9000\nPOSTGRES_HOST_PORT=${ports.POSTGRES_HOST_PORT}\nREDIS_HOST_PORT=${ports.REDIS_HOST_PORT}\nSERVER_HOST_PORT=${ports.SERVER_HOST_PORT}\nHEALTH_HOST_PORT=${ports.HEALTH_HOST_PORT}\n`,
		);
		expect(
			render(
				".env.development",
				"SHUTDOWN_DRAIN_DELAY_MS=0\nPORT=3000\nHEALTH_PORT=9000\n",
			),
		).toBe(
			`SHUTDOWN_DRAIN_DELAY_MS=0\nPORT=${ports.PORT}\nHEALTH_PORT=${ports.HEALTH_PORT}\n`,
		);
		expect(render("compose.yaml", compose)).toBe(
			"name: invoicing\nservices:\n  # varlock run -- docker compose -p invoicing up\n",
		);
		expect(
			JSON.parse(
				render(
					"package.json",
					'{"name":"app","scripts":{"dev":"varlock run -- docker compose -p app up && (HEALTH_PORT=9001 node src/worker.ts & vite)"}}',
				) ?? "",
			).scripts.dev,
		).toBe(
			`varlock run -- docker compose -p invoicing up && (HEALTH_PORT=${ports.WORKER_HEALTH_PORT} node src/worker.ts & vite)`,
		);
	});

	it.runIf(template)("keeps the Template's own ports and name", () => {
		const read = (name: string) => readFileSync(new URL(name, appRoot), "utf8");

		expect(read(".env.schema")).toContain("POSTGRES_HOST_PORT=5432\n");
		expect(read(".env.development")).toContain("PORT=3000\nHEALTH_PORT=9000\n");
		expect(read("package.json")).toContain("(HEALTH_PORT=9001 node --watch");
		expect(read("compose.yaml")).toContain("name: app\n");
	});
});

describe("lockfileRender", () => {
	const install = [
		"---",
		"lockfileVersion: '9.0'",
		"",
		"importers:",
		"",
		"  .:",
		"    configDependencies: {}",
		"",
		"packages:",
		"",
		"  pnpm@12.17.0: {}",
		"",
	].join("\n");
	const workspace = [
		"---",
		"lockfileVersion: '9.0'",
		"",
		"importers:",
		"",
		"  .:",
		"    devDependencies:",
		"      turbo:",
		"        specifier: ^2.11.10",
		"        version: 2.11.10",
		"",
		"  apps/app:",
		"    dependencies:",
		"      '@n8io/baseline-id':",
		"        specifier: workspace:^",
		"        version: link:../../packages/id",
		"      zod:",
		"        specifier: ^4.6.5",
		"        version: 4.6.7",
		"    devDependencies:",
		"      '@biomejs/biome':",
		"        specifier: ^2.6.5",
		"        version: 2.6.5",
		"",
		"  packages/id:",
		"    dependencies: {}",
		"",
		"packages:",
		"",
		"  zod@4.6.7: {}",
		"",
	].join("\n");

	it("keeps apps/app's locked versions as the only importer, without the workspace links", () => {
		const rendered = lockfileRender(install + workspace);

		expect(rendered.startsWith(install)).toBe(true);
		expect(rendered.slice(install.length).split("\n")).toEqual([
			"---",
			"lockfileVersion: '9.0'",
			"",
			"importers:",
			"",
			"  .:",
			"    dependencies:",
			"      zod:",
			"        specifier: ^4.6.5",
			"        version: 4.6.7",
			"    devDependencies:",
			"      '@biomejs/biome':",
			"        specifier: ^2.6.5",
			"        version: 2.6.5",
			"",
			"packages:",
			"",
			"  zod@4.6.7: {}",
			"",
		]);
	});

	it("refuses a lockfile with no apps/app importer", () => {
		expect(() => lockfileRender(install)).toThrow("no apps/app importer");
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
		expect(rendered.map((f) => f.path)).toContain("src/contexts/.gitkeep");
		// React Router serves static files from public/.
		expect(rendered.map((f) => f.path)).toContain("public/.gitkeep");
	});

	it("render README.md with the Project's name and the release package.json names", () => {
		const rendered = templateFilesRender(files, answers);
		const readme = rendered.find((f) => f.path === "README.md")?.text ?? "";
		const { version } = JSON.parse(
			readFileSync(new URL("package.json", appRoot), "utf8"),
		) as { version: string };
		expect(readme.split("\n").slice(0, 3)).toEqual([
			"# invoicing",
			"",
			"**Invoices for small shops.**",
		]);
		expect(readme).toContain(`[app@${version}]`);
	});

	it("empty every domains-start/domains-end pair, which domainsPairsFill fills back exactly", () => {
		const paired = files.filter((f) => domainsPairsFind(f.text, f.path).length);

		expect(paired.map((f) => f.path)).toEqual([
			"src/seed.ts",
			"src/server.ts",
			"src/ui/context.ts",
			"src/ui/routes.ts",
			"src/use-cases.ts",
			"src/worker.ts",
		]);
		for (const { path, text } of paired) {
			const rendered = templateFileRender({ path, text }, answers)?.text ?? "";
			const pairs = domainsPairsFind(rendered, path);

			expect(pairs.every(([start, end]) => end === start + 1)).toBe(true);
			expect(
				domainsPairsFill({ project: rendered, template: text, path }),
			).toBe(linesRemove(text, fooBlocksFind(text, path)));
		}
	});
});

describe("templateFinish", () => {
	const treeCreate = (schema: string) => {
		const folder = mkdtempDisposableSync(join(tmpdir(), "template-finish-"));
		writeFileSync(join(folder.path, ".env.schema"), schema);
		writeFileSync(join(folder.path, "env.d.ts"), "// the release's own\n");
		return folder;
	};
	const tools = new URL(".", appRoot).pathname;

	it("keeps the release's env types when the schema names a plugin these tools lack", () => {
		using folder = treeCreate(
			"# @plugin(@varlock/absent-plugin)\n# @generateTsTypes(path=env.d.ts)\n# ---\nA=1\n",
		);
		templateFinish(folder.path, tools);
		expect(readFileSync(join(folder.path, "env.d.ts"), "utf8")).toBe(
			"// the release's own\n",
		);
	});

	it("fails on any other codegen error", () => {
		using folder = treeCreate("# @defaultSensitive=false\n# ---\nA=1\n");
		expect(() => templateFinish(folder.path, tools)).toThrow(
			/No code-generation decorator/,
		);
	});
});
