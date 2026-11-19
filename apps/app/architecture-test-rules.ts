// The architecture rules as pure checks over source files. Imports come from
// es-module-lexer; everything else is a regular expression over the source text.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { init, parse } from "es-module-lexer";
import { transformWithOxc } from "vite";

export type ArchitectureImport = {
	specifier: string;
	// App-relative path for #imports and relative imports; the specifier itself for packages.
	target: string;
	typeOnly: boolean;
};

export type ArchitectureFile = {
	path: string;
	source: string;
	imports: ArchitectureImport[];
};

export type ArchitectureRule = (files: ArchitectureFile[]) => string[];

const aliasDirs: [string, string][] = [
	["#contexts/", "src/contexts/"],
	["#bridges/", "src/bridges/"],
	["#ui/", "src/ui/"],
];
const aliasFiles: Record<string, string> = {
	"#authn": "src/authn.ts",
	"#env": "src/env.ts",
};

const importTarget = (from: string, specifier: string): string => {
	if (specifier.startsWith(".")) {
		return path.posix.join(path.posix.dirname(from), specifier);
	}
	const file = aliasFiles[specifier];
	if (file) return file;
	for (const [alias, dir] of aliasDirs) {
		if (specifier.startsWith(alias)) return dir + specifier.slice(alias.length);
	}
	return specifier;
};

export const architectureFileCreate = async (
	filePath: string,
	source: string,
): Promise<ArchitectureFile> => {
	await init;
	// The lexer reads TypeScript but not JSX, so .tsx goes through Vite's transform first.
	const code = filePath.endsWith(".tsx")
		? // Like verbatimModuleSyntax: an unused value import still loads at runtime, so it stays.
			(
				await transformWithOxc(source, filePath, {
					typescript: { onlyRemoveTypeImports: true },
				})
			).code
		: source;
	const [records] = parse(code, filePath);
	const imports = records.flatMap((record) =>
		record.type === "import-meta" || record.specifier === undefined
			? []
			: [
					{
						specifier: record.specifier,
						target: importTarget(filePath, record.specifier),
						typeOnly:
							record.type === "dynamic"
								? record.probablyTypeOnly
								: record.typeOnly,
					},
				],
	);
	// The transform drops `import type` lines, so .tsx type-only imports are read from the source.
	const typeImports = filePath.endsWith(".tsx")
		? [
				...source.matchAll(
					/^\s*(?:import|export)\s+type\s[^;]*?\bfrom\s*["']([^"']+)["']/gm,
				),
			].map((m) => ({
				specifier: m[1] ?? "",
				target: importTarget(filePath, m[1] ?? ""),
				typeOnly: true,
			}))
		: [];
	return { imports: [...imports, ...typeImports], path: filePath, source };
};

// Every .ts and .tsx file under <appRoot>/src, except generated declarations.
export const architectureSrcRead = async (
	appRoot: string,
): Promise<ArchitectureFile[]> => {
	const names = readdirSync(path.join(appRoot, "src"), { recursive: true })
		.map((name) => `src/${String(name).split(path.sep).join("/")}`)
		.filter((name) => /\.tsx?$/.test(name) && !name.endsWith(".d.ts"))
		.sort();
	return Promise.all(
		names.map((name) =>
			architectureFileCreate(
				name,
				readFileSync(path.join(appRoot, name), "utf8"),
			),
		),
	);
};

// Where a path sits: its context, and the context-relative parts (`["domain", "bar.ts"]`).
const contextOf = (p: string): string | undefined =>
	/^src\/contexts\/([^/]+)\//.exec(p)?.[1];
const partsOf = (p: string): string[] => p.split("/").slice(3);
// A layer is "root" (index.ts), "domain", "application", "adapters/inbound" or "adapters/outbound".
const layerOfParts = (parts: string[]): string | undefined => {
	if (parts.length === 1) return "root";
	return parts[0] === "adapters" && parts.length > 2
		? `adapters/${parts[1]}`
		: parts[0];
};
const layerOf = (p: string): string | undefined =>
	contextOf(p) ? layerOfParts(partsOf(p)) : undefined;
const testIs = (p: string): boolean => /\.test\.tsx?$/.test(p);
// application/ holds the Use cases and ports.ts, the ports they take.
const applicationUseCaseIs = (p: string): boolean =>
	layerOf(p) === "application" &&
	!testIs(p) &&
	!p.endsWith("/application/ports.ts");
const businessIs = (p: string): boolean =>
	["root", "domain", "application"].includes(layerOf(p) ?? "");
const contextsOf = (files: ArchitectureFile[]): string[] => [
	...new Set(files.flatMap((f) => contextOf(f.path) ?? [])),
];
const camel = (kebab: string): string =>
	kebab.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const snake = (kebab: string): string => kebab.replaceAll("-", "_");
const tableIs = (p: string): boolean =>
	/^src\/contexts\/[^/]+\/adapters\/outbound\/[^/]+-table\.ts$/.test(p);
// A context's Aggregates: a model in domain/ with its own table in adapters/outbound/. A table
// with no model of its name (a projection) is not one.
const aggregatesOf = (files: ArchitectureFile[], context: string): string[] =>
	files.flatMap((f) => {
		const name = new RegExp(
			`^src/contexts/${context}/adapters/outbound/([^/]+)-table\\.ts$`,
		).exec(f.path)?.[1];
		return name &&
			files.some((m) => m.path === `src/contexts/${context}/domain/${name}.ts`)
			? [name]
			: [];
	});
const roots = ["src/server.ts", "src/worker.ts", "src/seed.ts"];
// Where Use cases are built: domainsUseCasesCreate, and any composition root that still does.
const useCasesBuilders = [...roots, "src/use-cases.ts"];

// One message per offending import: `check` returns the reason, or undefined when allowed.
const importsCheck = ({
	check,
	fileIs,
	files,
}: {
	check: (found: {
		context: string | undefined;
		f: ArchitectureFile;
		imp: ArchitectureImport;
	}) => string | undefined;
	fileIs: (f: ArchitectureFile) => boolean;
	files: ArchitectureFile[];
}): string[] =>
	files.filter(fileIs).flatMap((f) =>
		f.imports.flatMap((imp) => {
			const reason = check({ context: contextOf(f.path), f, imp });
			return reason ? [`${f.path} imports ${imp.specifier}: ${reason}`] : [];
		}),
	);

// One message per regex match in the files `fileIs` selects.
const textCheck = ({
	fileIs,
	files,
	pattern,
	reason,
}: {
	fileIs: (f: ArchitectureFile) => boolean;
	files: ArchitectureFile[];
	pattern: RegExp;
	reason: (match: RegExpExecArray, f: ArchitectureFile) => string | undefined;
}): string[] =>
	files.filter(fileIs).flatMap((f) =>
		[...f.source.matchAll(pattern)].flatMap((match) => {
			const message = reason(match, f);
			return message ? [`${f.path}: ${message}`] : [];
		}),
	);

const sameContextParts = (
	imp: ArchitectureImport,
	context: string | undefined,
): string[] | undefined =>
	context && contextOf(imp.target) === context
		? partsOf(imp.target)
		: undefined;
// The layer an import reaches in the importing file's own context.
const sameContextLayer = (
	imp: ArchitectureImport,
	context: string | undefined,
): string | undefined => {
	const parts = sameContextParts(imp, context);
	return parts ? layerOfParts(parts) : undefined;
};

// A23 reads every exported function. React Router's own export names, React hooks and
// components are exempt from all of it; `ok` and `err` are the result package's two constructors.
const leadingVerbs =
	"add|build|calculate|can|check|clear|close|compute|connect|convert|create|delete|fetch|find|format|get|handle|has|init|is|list|load|make|open|parse|read|register|remove|render|reset|run|save|send|set|should|sign|start|stop|update|validate|wait|write";
const frameworkNames = new Set(["action", "handleError", "links", "loader"]);
const unscopedNames = new Set(["err", "ok"]);
const exemptIs = (name: string): boolean =>
	frameworkNames.has(name) || /^[A-Z]|^use[A-Z]/.test(name);
const exportedVerbFirst = new RegExp(
	`^export (?:const|let|function|async function) ((${leadingVerbs})([A-Z0-9]\\w*))`,
	"gm",
);
// `export const x = (…) =>`, `export const x: T = async <G>(…) =>` and `export function x(…)`.
const exportedFunction =
	/^export (?:const (\w+)(?:\s*:[^=]*)?\s*=\s*(?:async\s*)?(?:<[^=;]*?>\s*)?\(|(?:async )?function (\w+))/gm;
// The same, up to an explicit `boolean` or type-predicate return.
const exportedPredicate =
	/^export (?:const (\w+)(?:\s*:[^=]*)?\s*=\s*(?:async\s*)?|(?:async )?function (\w+)\s*)(?:<[^=;]*?>\s*)?\((?:[^()]|\([^()]*\))*\)\s*:\s*(?:boolean\b|\w+ is\b)/gm;
// A function named after the thing it returns builds that thing, so it ends in Create. A const
// typed as the thing (`httpErrorHandle: ErrorHandler = (…) =>`) is the thing, not its factory.
const exportedUntypedFunction =
	/^export (?:const (\w+)\s*=\s*(?:async\s*)?(?:<[^=;]*?>\s*)?\(|(?:async )?function (\w+))/gm;
const thingWords =
	/(Body|Cache|Column|Consumer|Handle|Handler|Hub|Memory|Middleware|Options|PgBoss|Pool|Ports|Postgres|Reader|Redis|Repository|Responses|Routes|Schedule|Schema|Transaction)$/;
// The scope a file's exports start with: its package (packages/<name>/src) or context.
const scopeOf = (p: string): string | undefined => {
	const pkg = /^packages\/([^/]+)\/src\//.exec(p)?.[1];
	const context = /(?:^|\/)src\/contexts\/([^/]+)\//.exec(p)?.[1];
	const scope = pkg ?? context;
	return scope ? camel(scope) : undefined;
};

// What domain/ imports from outside its context: Zod and the id schema, and the shared kernel's
// types (the Actor, an id and a Result).
const domainImportsAllowed = new Set(["src/id-schema.ts", "zod"]);
const domainTypePackages = new Set([
	"@n8io/baseline-authn",
	"@n8io/baseline-id",
	"@n8io/baseline-result",
]);

// The names a file imports as values from its own context's domain/ or entry.
const sharedSchemaNames = (f: ArchitectureFile): string[] => {
	const context = contextOf(f.path);
	const names: string[] = [];
	for (const m of f.source.matchAll(
		/^import\s+\{([^}]*)\}\s*from\s*["']([^"']+)["']/gm,
	)) {
		const parts = sameContextParts(
			{
				specifier: m[2] ?? "",
				target: importTarget(f.path, m[2] ?? ""),
				typeOnly: false,
			},
			context,
		);
		if (parts && (parts[0] === "domain" || parts.join("/") === "index.ts")) {
			for (const part of (m[1] ?? "").split(",")) {
				if (/^\s*type\s/.test(part)) continue;
				const name = part
					.trim()
					.split(/\s+as\s+/)
					.pop();
				if (name) names.push(name);
			}
		}
	}
	return names;
};

export const architectureRules: Record<string, ArchitectureRule> = {
	A1: (files) =>
		importsCheck({
			files,
			fileIs: (f) => businessIs(f.path) && !testIs(f.path),
			check: ({ context, imp }) => {
				return sameContextParts(imp, context)?.[0] === "adapters"
					? "business code never imports adapters/; declare what it needs as a port in domain/repositories.ts or application/ports.ts and let the composition roots wire the adapter"
					: undefined;
			},
		}),

	A2: (files) =>
		importsCheck({
			files,
			fileIs: (f) => layerOf(f.path) === "domain" && !testIs(f.path),
			check: ({ context, imp }) =>
				sameContextLayer(imp, context) === "domain" ||
				domainImportsAllowed.has(imp.target) ||
				(domainTypePackages.has(imp.target) && imp.typeOnly)
					? undefined
					: "domain/ is pure: it imports only its own domain/, zod, src/id-schema.ts and the types of the authn, id and result packages; move this to a Use case in application/",
		}),

	A3: (files) =>
		importsCheck({
			files,
			fileIs: (f) => layerOf(f.path) === "adapters/inbound" && !testIs(f.path),
			check: ({ context, imp }) => {
				const parts = sameContextParts(imp, context);
				if (!parts) return undefined;
				const layer = layerOfParts(parts);
				if (layer === "adapters/outbound") {
					return "adapters/inbound/ never imports adapters/outbound/; the composition roots pass use cases built on the adapters";
				}
				const allowed =
					parts.join("/") === "index.ts" ||
					layer === "domain" ||
					layer === "adapters/inbound" ||
					(layer === "application" && imp.typeOnly);
				return allowed
					? undefined
					: "adapters/inbound/ reaches the context only through its index.ts, domain/ and Use case types";
			},
		}),

	A4: (files) =>
		importsCheck({
			files,
			fileIs: (f) => layerOf(f.path) === "adapters/outbound" && !testIs(f.path),
			check: ({ context, imp }) => {
				const parts = sameContextParts(imp, context);
				if (!parts) return undefined;
				const layer = layerOfParts(parts);
				const allowed =
					layer === "domain" ||
					layer === "adapters/outbound" ||
					parts.join("/") === "application/ports.ts";
				return allowed
					? undefined
					: "adapters/outbound/ implements ports: from its context it imports only domain/ and application/ports.ts";
			},
		}),

	A5: (files) =>
		importsCheck({
			files,
			fileIs: (f) => contextOf(f.path) === undefined,
			check: ({ imp }) => {
				const target = contextOf(imp.target);
				if (!target) return undefined;
				const entry = partsOf(imp.target).join("/");
				return [
					"index.ts",
					"adapters/inbound/index.ts",
					"adapters/outbound/index.ts",
				].includes(entry)
					? undefined
					: `outside a context, import only src/contexts/${target}/index.ts, adapters/inbound/index.ts or adapters/outbound/index.ts; export what you need from one of them`;
			},
		}),

	A6: (files) =>
		importsCheck({
			files,
			fileIs: (f) => contextOf(f.path) !== undefined,
			check: ({ context, f, imp }) => {
				const target = contextOf(imp.target);
				if (!target || target === context) return undefined;
				const handler =
					layerOf(f.path) === "adapters/inbound" &&
					f.path.endsWith("-handler.ts");
				return handler && partsOf(imp.target).join("/") === "index.ts"
					? undefined
					: `contexts never import each other; read ${target} through a bridge in src/bridges/, or handle its event in adapters/inbound/${context}-${target}-<event>-handler.ts`;
			},
		}),

	A7: (files) => [
		...importsCheck({
			files,
			fileIs: (f) => layerOf(f.path) === "domain",
			check: ({ imp }) =>
				imp.specifier.startsWith("@hono/")
					? "domain/ stays free of HTTP; put OpenAPI schemas in adapters/inbound/<context>-routes.ts"
					: undefined,
		}),
		...textCheck({
			files,
			fileIs: (f) => layerOf(f.path) !== "adapters/inbound",
			pattern: /\.openapi\(/g,
			reason: () =>
				".openapi( appears only in a context's adapters/inbound/; put OpenAPI schemas and routes in adapters/inbound/<context>-routes.ts",
		}),
	],

	A8: (files) =>
		importsCheck({
			files,
			fileIs: (f) => !testIs(f.path),
			check: ({ f, imp }) => {
				if (imp.specifier.startsWith("@opentelemetry/")) {
					return "src/ never imports OpenTelemetry; use telemetrySpanAttributesSet and telemetrySpanRun from @n8io/baseline-telemetry/span";
				}
				return imp.specifier === "@n8io/baseline-telemetry/span" &&
					layerOf(f.path) !== "application"
					? "only use cases touch spans; set span attributes in application/, and wrap use cases with telemetryUseCasesTrace in src/use-cases.ts"
					: undefined;
			},
		}),

	A9: (files) =>
		importsCheck({
			files,
			fileIs: (f) =>
				(f.path.startsWith("src/contexts/") || f.path.startsWith("src/ui/")) &&
				f.path !== "src/ui/entry.server.tsx",
			check: ({ imp }) =>
				imp.specifier === "@n8io/baseline-logger"
					? "contexts and the UI never log; return an error or set a span attribute, and log in the composition roots (src/ui/entry.server.tsx for page errors)"
					: undefined,
		}),

	A10: (files) =>
		importsCheck({
			files,
			fileIs: (f) =>
				(f.path.startsWith("src/ui/") || contextOf(f.path) !== undefined) &&
				!testIs(f.path),
			check: ({ f, imp }) => {
				if (f.path.startsWith("src/ui/")) {
					const target = contextOf(imp.target);
					return target && partsOf(imp.target).join("/") !== "index.ts"
						? `the UI calls contexts only through src/contexts/${target}/index.ts; loaders and actions get use cases from the load context`
						: undefined;
				}
				return imp.target.startsWith("src/ui/")
					? "contexts never import the UI; the UI calls the context"
					: undefined;
			},
		}),

	A11: (files) => {
		const bridges = files.filter(
			(f) => f.path.startsWith("src/bridges/") && !testIs(f.path),
		);
		const messages = bridges.flatMap((f) => {
			const contextImports = f.imports.filter((imp) => contextOf(imp.target));
			const entryMisses = contextImports
				.filter((imp) => partsOf(imp.target).join("/") !== "index.ts")
				.map(
					(imp) =>
						`${f.path} imports ${imp.specifier}: a bridge imports only each context's index.ts`,
				);
			const contexts = [
				...new Set(
					contextImports.flatMap((imp) => contextOf(imp.target) ?? []),
				),
			];
			const countMiss =
				contexts.length === 2
					? []
					: [
							`${f.path}: a bridge connects exactly two contexts through their index.ts; it imports ${contexts.length} (${contexts.join(", ") || "none"})`,
						];
			const callMisses = contexts.flatMap((d) =>
				[
					...f.source.matchAll(
						new RegExp(`\\b(${camel(d)}[A-Z]\\w*)\\s*\\(`, "g"),
					),
				]
					.map((m) => m[1] ?? "")
					.filter((name) => !/(Get|List)$/.test(name))
					.map(
						(name) =>
							`${f.path}: a bridge only reads, so it calls only *Get and *List use cases, not ${name}; a change belongs in a use case of the context that owns it`,
					),
			);
			return [...entryMisses, ...countMiss, ...callMisses];
		});
		const contextImports = importsCheck({
			files,
			fileIs: (f) => contextOf(f.path) !== undefined,
			check: ({ imp }) =>
				imp.target.startsWith("src/bridges/")
					? "no context imports a bridge; the composition roots pass the bridge in as the context's read port"
					: undefined,
		});
		return [...messages, ...contextImports];
	},

	A12: (files) => [
		...textCheck({
			files,
			fileIs: (f) =>
				contextOf(f.path) !== undefined &&
				["application/ports.ts", "domain/repositories.ts"].includes(
					partsOf(f.path).join("/"),
				),
			pattern: /\bclose\s*\??\s*[(:<]/g,
			reason: () =>
				"no port declares close; the composition roots open and close connections",
		}),
		...textCheck({
			files,
			fileIs: (f) => contextOf(f.path) !== undefined && !testIs(f.path),
			pattern:
				/\b(new Pool|createClient|postgresPoolCreate|redisClientCreate|queueCreate)\(/g,
			reason: (m) =>
				`${m[1]}( opens a connection; the composition roots (src/server.ts, src/worker.ts, src/seed.ts) own connections and pass them to <context>PortsCreate through src/use-cases.ts`,
		}),
		...textCheck({
			files,
			fileIs: (f) => contextOf(f.path) !== undefined && !testIs(f.path),
			pattern: /\bcacheStoreRedisCreate\(/g,
			reason: () =>
				"cacheStoreRedisCreate( picks the cache's backend; src/cache-store-open.ts does that, and a context builds its cache on connections.cacheStore",
		}),
		...textCheck({
			files,
			fileIs: (f) =>
				!testIs(f.path) &&
				!/^src\/(connections|[a-z-]+-open)\.ts$/.test(f.path),
			pattern:
				/\b(analyticsMixpanelCreate|cacheStoreRedisCreate|errorTrackingSentryCreate|liveHubRedisCreate|postgresPoolCreate|queueCreate|redisClientCreate)\(/g,
			reason: (m) =>
				`${m[1]}( picks a vendor and takes its settings; only src/connections.ts and the src/*-open.ts files do that`,
		}),
	],

	A13: (files) => [
		...textCheck({
			files,
			fileIs: (f) => !tableIs(f.path) && !testIs(f.path),
			pattern: /\bpgSchema\(|\bpgTable\(|\.table\(\s*["'`]/g,
			reason: () =>
				"tables live only in src/contexts/<context>/adapters/outbound/<aggregate>-table.ts",
		}),
		...textCheck({
			files,
			fileIs: (f) => tableIs(f.path),
			pattern: /\bpgTable\b/g,
			reason: (_m, f) =>
				`no bare pgTable; define tables with pgSchema("${snake(contextOf(f.path) ?? "")}").table(...)`,
		}),
		...files
			.filter(
				(f) => tableIs(f.path) && !f.source.includes("// glossary-rename:"),
			)
			.flatMap((f) => {
				const schema = snake(contextOf(f.path) ?? "");
				return new RegExp(`\\bpgSchema\\(\\s*["'\`]${schema}["'\`]`).test(
					f.source,
				)
					? []
					: [
							`${f.path}: tables use pgSchema("${schema}"), named after the context folder; mark a deliberate rename with // glossary-rename: <why>`,
						];
			}),
		...importsCheck({
			files,
			fileIs: () => true,
			check: ({ context, imp }) => {
				const owner = tableIs(imp.target) ? contextOf(imp.target) : undefined;
				return owner && owner !== context
					? `another context's table is private to ${owner}; read ${owner} through a bridge`
					: undefined;
			},
		}),
	],

	A14: (files) => {
		const contexts = contextsOf(files);
		return files
			.filter((f) => tableIs(f.path))
			.flatMap((f) => {
				const context = contextOf(f.path) ?? "";
				const handlers = files.filter(
					(c) =>
						c.path.startsWith(`src/contexts/${context}/adapters/inbound/`) &&
						c.path.endsWith("-handler.ts"),
				);
				// A column helper hoisted into a sibling adapters/outbound/ file still builds the column, so the
				// files the table imports from its own folder are read with it.
				const folder = f.path.slice(0, f.path.lastIndexOf("/") + 1);
				const imported = [
					...f.source.matchAll(/from\s+["'`]\.\/([^"'`]+?)(?:\.ts)?["'`]/g),
				]
					.map((m) => files.find((c) => c.path === `${folder}${m[1]}.ts`))
					.map((c) => c?.source ?? "");
				const source = [f.source, ...imported].join("\n");
				// Another context's id, or an id of one of its Aggregates, is a column built with that id's
				// prefix, whatever it is named (proposer_team_id); a plain uuid("proposer_team_id") or a
				// column named <other>_id counts too. An id of the context's own Aggregate needs no handler.
				// The context's own names count while picking the longest match, so its order-item id
				// is not read as another context's item id, then drop out: they need no handler.
				const own = new Set([context, ...aggregatesOf(files, context)]);
				const held = [
					...new Set(
						contexts.flatMap((other) => [other, ...aggregatesOf(files, other)]),
					),
				]
					.filter((other) => {
						const camelOther = camel(other);
						const capital = `${camelOther.charAt(0).toUpperCase()}${camelOther.slice(1)}`;
						return new RegExp(
							`postgresIdColumnCreate(?:<[^>]*>)?\\(\\s*["'\`](?:${other}|${snake(other)}|${camelOther})["'\`]\\s*,?\\s*\\)|["'\`](?:[a-z0-9_]*_)?${snake(other)}_id["'\`]|(?:\\b${camelOther}|[a-z0-9]${capital})Id\\s*:`,
						).test(source);
					})
					// work-order's column also reads as an order id: only the longest name counts.
					.filter(
						(other, _i, matched) =>
							!matched.some((longer) => longer.endsWith(`-${other}`)),
					)
					.filter((other) => !own.has(other));
				return held
					.filter(
						(other) =>
							!handlers.some((c) =>
								new RegExp(`["'\`]${other}\\.deleted["'\`]`).test(c.source),
							),
					)
					.map(
						(other) =>
							`${f.path}: a column holding a ${other} id needs src/contexts/${context}/adapters/inbound/${context}-${other}-deleted-handler.ts handling "${other}.deleted", so rows never point at a deleted ${other}`,
					);
			});
	},

	A15: (files) =>
		textCheck({
			files,
			fileIs: (f) => layerOf(f.path) === "adapters/outbound",
			pattern: /\bsql\.raw\b/g,
			reason: () =>
				"sql.raw is banned in adapters/outbound/; build queries with Drizzle or the sql`` template, which binds parameters",
		}),

	A16: (files) =>
		files
			.filter((f) => applicationUseCaseIs(f.path))
			.flatMap((f) => {
				const context = snake(contextOf(f.path) ?? "");
				// A key that is not a plain string literal reads as itself and fails the pattern.
				const single = [
					...f.source.matchAll(/\.setAttribute\(\s*([^,)]+)/g),
				].map(
					(m) =>
						/^(["'])([^"'`]+)\1$/.exec((m[1] ?? "").trim())?.[2] ?? m[1] ?? "",
				);
				// Keys are what follows `{` or a comma: shorthand counts, a ternary's branches do not.
				const many = [
					...f.source.matchAll(
						/(?:\.setAttributes|\btelemetrySpanAttributesSet)\(\s*\{([^}]*)\}/g,
					),
				].flatMap((m) =>
					[
						...`,${m[1] ?? ""}`.matchAll(
							/,\s*(?:(["'])([^"'`]+)\1|([A-Za-z_$`[][^\s:,]*))\s*(?=[:,]|$)/g,
						),
					].map((k) => k[2] ?? k[3] ?? ""),
				);
				// An Aggregate's Use cases may name the Aggregate instead: baseline.invoice_line.id.
				const scopes = [
					context,
					...aggregatesOf(files, contextOf(f.path) ?? "").map(snake),
				].join("|");
				const valid = new RegExp(
					`^baseline\\.(${scopes})\\.(id|[a-z][a-z0-9_]*_(id|count))$`,
				);
				return [...single, ...many]
					.filter((key) => !valid.test(key))
					.map(
						(key) =>
							`${f.path}: span attribute ${key} must be baseline.${context}.id or baseline.${context}.<thing>_id, or a baseline.${context}.<thing>_count; never put names or other personal data on spans`,
					);
			}),

	A17: (files) =>
		textCheck({
			files,
			fileIs: (f) =>
				f.path === "src/ui/routes.ts" ||
				(layerOf(f.path) === "adapters/inbound" &&
					!testIs(f.path) &&
					/-(routes|live)\.ts$/.test(f.path)),
			pattern: /(["'`])([^"'`\n]*\/[^"'`\n]*)\1/g,
			reason: (m) => {
				const names = [
					...(m[2] ?? "").matchAll(
						/:([A-Za-z_]\w*)|(?<!\$)\{([A-Za-z_]\w*)\}/g,
					),
				]
					.map((p) => p[1] ?? p[2] ?? "")
					.filter((name) => !name.endsWith("Id"));
				return names.length > 0
					? `path parameter ${names.join(", ")} in "${m[2]}" must end in Id (:<thing>Id)`
					: undefined;
			},
		}),

	A18: (files) => {
		const contexts = contextsOf(files);
		const server = files.find((f) => f.path === "src/server.ts");
		const mounted = contexts
			.filter(
				(d) =>
					!server?.imports.some((imp) =>
						imp.target.startsWith(`src/contexts/${d}/`),
					),
			)
			.map(
				(d) =>
					`src/server.ts: never imports src/contexts/${d}; mount its routes there, with its use cases from src/use-cases.ts`,
			);
		const unwrapped = files
			.filter((f) => useCasesBuilders.includes(f.path))
			.flatMap((f) =>
				contexts.flatMap((d) =>
					[
						...f.source.matchAll(
							new RegExp(
								`(?<!telemetryUseCasesTrace\\(\\s*)\\b${camel(d)}UseCasesCreate\\(`,
								"g",
							),
						),
					].map(
						() =>
							`${f.path}: wrap ${camel(d)}UseCasesCreate(...) in telemetryUseCasesTrace(...) so every use case gets a span`,
					),
				),
			);
		return [...mounted, ...unwrapped];
	},

	A19: (files) =>
		importsCheck({
			files,
			fileIs: (f) =>
				contextOf(f.path) !== undefined &&
				layerOf(f.path) !== "adapters/outbound" &&
				!testIs(f.path),
			check: ({ imp }) =>
				/^src\/contexts\/[^/]+\/adapters\/outbound\/.*\.memory\.ts$/.test(
					imp.target,
				)
					? "only *.test.ts files (and adapters/outbound/) import memory adapters; production code gets ports from <context>PortsCreate in adapters/outbound/index.ts"
					: undefined,
		}),

	A20: (files) =>
		textCheck({
			files,
			fileIs: (f) => contextOf(f.path) !== undefined,
			pattern: /@ts-(expect-error|ignore)\b/g,
			reason: (m) =>
				`@ts-${m[1]} is banned in src/contexts/; fix the type instead`,
		}),

	A21: (files) =>
		importsCheck({
			files,
			fileIs: (f) => businessIs(f.path) && !testIs(f.path),
			check: ({ f, imp }) => {
				const pkg = /^@n8io\/baseline-[^/]+/.exec(imp.specifier)?.[0];
				if (!pkg) return undefined;
				if (pkg === "@n8io/baseline-result" || pkg === "@n8io/baseline-id") {
					return undefined;
				}
				if (
					imp.specifier === "@n8io/baseline-telemetry/span" &&
					layerOf(f.path) === "application"
				) {
					return undefined;
				}
				const typeAllowed =
					imp.typeOnly &&
					(pkg === "@n8io/baseline-queue" || pkg === "@n8io/baseline-authn") &&
					["domain", "application"].includes(layerOf(f.path) ?? "");
				return typeAllowed
					? undefined
					: "business code imports only @n8io/baseline-result and @n8io/baseline-id, plus @n8io/baseline-telemetry/span in application/ and `import type` of Inbox (queue) and Actor (authn) in domain/ and application/; reach any other shared package through a port implemented in adapters/outbound/";
			},
		}),

	A22: (files) => [
		...importsCheck({
			files,
			fileIs: (f) => !testIs(f.path),
			check: ({ f, imp }) => {
				if (imp.specifier === "varlock/env" && f.path !== "src/env.ts") {
					return "only src/env.ts imports varlock/env; import ENV from #env in a composition root or src/connections.ts";
				}
				const rootsWithEnv = [
					...roots,
					"src/authn.ts",
					// Opens every connection for the roots, so it reads their settings itself.
					"src/connections.ts",
					"src/migrate.ts",
					"src/blocked-keys.ts",
				];
				return imp.target === "src/env.ts" && !rootsWithEnv.includes(f.path)
					? "only the composition roots, src/authn.ts and src/connections.ts read #env; pass the values in as arguments (the UI gets them from the load context)"
					: undefined;
			},
		}),
		...textCheck({
			files,
			fileIs: (f) => !testIs(f.path),
			pattern: /\bprocess\.env\b/g,
			reason: () =>
				"process.env is read only through ENV from #env (declare the item in .env.schema)",
		}),
	],

	A23: (files) => [
		...textCheck({
			files,
			fileIs: () => true,
			pattern: exportedVerbFirst,
			reason: ([, name = "", verb = "", rest = ""]) =>
				exemptIs(name)
					? undefined
					: `${name} starts with a verb; name it generic to specific, scope then subject then action: ${rest.charAt(0).toLowerCase()}${rest.slice(1)}${verb.charAt(0).toUpperCase()}${verb.slice(1)}`,
		}),
		...textCheck({
			files,
			fileIs: () => true,
			pattern: exportedUntypedFunction,
			reason: ([, constName, functionName]) => {
				const name = constName ?? functionName ?? "";
				return !exemptIs(name) && thingWords.test(name)
					? `${name} builds and returns a thing; a factory ends in Create: ${name}Create`
					: undefined;
			},
		}),
		...textCheck({
			files,
			fileIs: () => true,
			pattern: exportedPredicate,
			reason: ([, constName, functionName]) => {
				const name = constName ?? functionName ?? "";
				return !exemptIs(name) && !/(Is|Has|Can)$/.test(name)
					? `${name} returns a boolean; a predicate ends in Is, Has or Can (barDeleteCan, barStaleIs)`
					: undefined;
			},
		}),
		...textCheck({
			files,
			fileIs: (f) => !testIs(f.path) && scopeOf(f.path) !== undefined,
			pattern: exportedFunction,
			reason: ([, constName, functionName], f) => {
				const name = constName ?? functionName ?? "";
				const scope = scopeOf(f.path) ?? "";
				// A context's export may start with one of its Aggregates' names instead.
				const context = contextOf(f.path);
				const scopes = [
					scope,
					...(context ? aggregatesOf(files, context).map(camel) : []),
				];
				return exemptIs(name) ||
					unscopedNames.has(name) ||
					scopes.some((s) => new RegExp(`^${s}(?:[A-Z0-9]|$)`).test(name))
					? undefined
					: `${name} is exported from ${scope}; start every exported function with its package or context name, or one of its context's Aggregates: ${scope}${name.charAt(0).toUpperCase()}${name.slice(1)}`;
			},
		}),
	],

	A24: (files) =>
		importsCheck({
			files,
			fileIs: (f) => !testIs(f.path) && !/(^|\/)test\//.test(f.path),
			check: ({ imp }) =>
				/^@n8io\/baseline-[^/]+\/testing$/.test(imp.specifier)
					? "only *.test.ts(x) files and files under test/ import a Package's test helpers; production code imports @n8io/baseline-<package>, where its memory adapter is"
					: undefined,
		}),

	// A7 keeps OpenAPI out of domain/. A model is plain Zod, so `.openapi` is missing on it until
	// @hono/zod-openapi has loaded: a call on one works or throws with test order.
	A25: (files) =>
		files
			.filter((f) => layerOf(f.path) === "adapters/inbound" && !testIs(f.path))
			.flatMap((f) => {
				const names = sharedSchemaNames(f);
				if (names.length === 0) return [];
				const pattern = new RegExp(
					`\\b(${names.join("|")})\\b(?:\\s*\\.\\s*shape\\s*\\.\\s*\\w+)?\\s*\\.\\s*openapi\\(`,
					"g",
				);
				return [...f.source.matchAll(pattern)].map(
					(m) =>
						`${f.path}: ${m[1]}.openapi( is called on a schema imported from domain/, which has no .openapi until @hono/zod-openapi loads; build the API's own schema (z.object({ id: ${m[1]}.shape.id }).openapi("<Name>"))`,
				);
			}),

	// The time comes from the Clock port, so a test sets it instead of faking timers.
	A26: (files) =>
		textCheck({
			files,
			fileIs: (f) => applicationUseCaseIs(f.path),
			pattern: /\bnew Date\(\s*\)|\bDate\.now\(\s*\)/g,
			reason: (m) =>
				`${m[0]} reads the system time in a Use case; read <context>Clock.now() from the ports, so a test sets the time`,
		}),

	// An expected outcome is part of the return type, so every caller sees it. Only adapters (adapters/outbound/,
	// Packages) throw, for the unexpected, and telemetryUseCasesTrace records what they throw. A
	// bug that cannot happen may `throw new Error(...)` directly under a one-line
	// `// unreachable: <why>`, so a request fails loudly and an Event handler's Event retries: an err would
	// complete the Event. Strings are blanked first and then comments, keeping offsets, so neither
	// hides code from the other and the word "throw" in either never counts.
	A27: (files) =>
		files
			.filter(
				(f) =>
					["domain", "application"].includes(layerOf(f.path) ?? "") &&
					!testIs(f.path),
			)
			.flatMap((f) => {
				const blank = (c: string) => c.replace(/[^\n]/g, " ");
				const noStrings = f.source.replace(
					/\/\*[\s\S]*?\*\/|\/\/.*$|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\[\s\S]|[^`\\])*`/gm,
					(c) => (c.startsWith("/") ? c : blank(c)),
				);
				const code = noStrings.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, blank);
				const kind = layerOf(f.path) === "domain" ? "domain/ file" : "Use case";
				const lines = noStrings.split("\n");
				return [
					...code.matchAll(
						/(?<!\.)\bthrow\b(?!\s*[:(])|\btry\s*\{|\bcatch\b(?!\s*:)|\bPromise\s*\.\s*reject\b/g,
					),
				].flatMap((m) => {
					const word = m[0].replace(/\s*\{$/, "").replace(/\s+/g, "");
					const line = code.slice(0, m.index).split("\n").length;
					if (
						word === "throw" &&
						/^throw\s+new\s+Error\(/.test(code.slice(m.index)) &&
						/^\s*\/\/ unreachable: \S+(\s+\S+){2,}\s*$/.test(
							lines[line - 2] ?? "",
						)
					) {
						return [];
					}
					const where = `${f.path}:${line}: ${word} in a ${kind}`;
					if (word !== "throw") {
						return [
							`${where}; move the call that throws behind a port in adapters/outbound/, which returns its failure as a Result`,
						];
					}
					const instead =
						kind === "domain/ file"
							? "domain/ returns a plain value (a boolean or a reason) and the Use case turns it into err(...)"
							: "return err(new <Name>Error()) and add the error to the Use case's error union";
					return [
						`${where}; ${instead}. Only a bug that cannot happen throws (never not-found, forbidden, conflict or validation): throw new Error(...) directly under a one-line "// unreachable: <why, in a few words>"`,
					];
				});
			}),

	// One Aggregate per transaction: a transaction whose work reaches two Aggregates' repositories
	// says which invariant needs both, in a `// invariant: <what>` comment right above the call.
	// The ports already keep a transaction inside one context.
	A28: (files) =>
		files
			.filter((f) => applicationUseCaseIs(f.path))
			.flatMap((f) => {
				const lines = f.source.split("\n");
				return [
					...f.source.matchAll(/\b\w+Transaction\s*(?:<[^()]*?>)?\s*\(/g),
				].flatMap((m) => {
					// The call's own text, to its closing bracket.
					let depth = 0;
					let end = m.index + m[0].length - 1;
					for (; end < f.source.length; end++) {
						const c = f.source[end];
						if (c === "(") depth++;
						else if (c === ")" && --depth === 0) break;
					}
					const work = f.source.slice(m.index, end);
					const repositories = new Set(
						[...work.matchAll(/\b(\w+?)Repository\b/g)]
							.map((r) => r[1] ?? "")
							.filter((name) => !/Read$|^[A-Z]/.test(name)),
					);
					if (repositories.size < 2) return [];
					// The comment lines right above the statement the call is in.
					let line = f.source.slice(0, m.index).split("\n").length - 1;
					const above: string[] = [];
					while (/^\s*\/\//.test(lines[line - 1] ?? ""))
						above.push(lines[--line] ?? "");
					return above.some((l) =>
						/^\s*\/\/ invariant: \S+(\s+\S+){2,}/.test(l),
					)
						? []
						: [
								`${f.path}:${line + 1}: one transaction writes ${[...repositories].sort().join(" and ")}; keep one Aggregate per transaction, or say the invariant that needs both in a "// invariant: <what>" comment above it`,
							];
				});
			}),
};
