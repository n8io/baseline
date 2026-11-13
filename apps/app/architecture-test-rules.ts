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
	["#domains/", "src/domains/"],
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

// Where a path sits: its domain, and the domain-relative parts (`["models", "bar.ts"]`).
const domainOf = (p: string): string | undefined =>
	/^src\/domains\/([^/]+)\//.exec(p)?.[1];
const partsOf = (p: string): string[] => p.split("/").slice(3);
const layerOf = (p: string): string | undefined => {
	if (!domainOf(p)) return undefined;
	const parts = partsOf(p);
	return parts.length === 1 ? "root" : parts[0];
};
const testIs = (p: string): boolean => /\.test\.tsx?$/.test(p);
const businessIs = (p: string): boolean =>
	["root", "models", "rules", "use-cases"].includes(layerOf(p) ?? "");
const domainsOf = (files: ArchitectureFile[]): string[] => [
	...new Set(files.flatMap((f) => domainOf(f.path) ?? [])),
];
const camel = (kebab: string): string =>
	kebab.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const snake = (kebab: string): string => kebab.replaceAll("-", "_");
const tableIs = (p: string): boolean =>
	/^src\/domains\/[^/]+\/spi\/[^/]+-table\.ts$/.test(p);
const roots = ["src/server.ts", "src/worker.ts", "src/seed.ts"];

// One message per offending import: `check` returns the reason, or undefined when allowed.
const importsCheck = (
	files: ArchitectureFile[],
	fileIs: (f: ArchitectureFile) => boolean,
	check: (
		imp: ArchitectureImport,
		f: ArchitectureFile,
		domain: string | undefined,
	) => string | undefined,
): string[] =>
	files.filter(fileIs).flatMap((f) =>
		f.imports.flatMap((imp) => {
			const reason = check(imp, f, domainOf(f.path));
			return reason ? [`${f.path} imports ${imp.specifier}: ${reason}`] : [];
		}),
	);

// One message per regex match in the files `fileIs` selects.
const textCheck = (
	files: ArchitectureFile[],
	fileIs: (f: ArchitectureFile) => boolean,
	pattern: RegExp,
	reason: (match: RegExpExecArray, f: ArchitectureFile) => string | undefined,
): string[] =>
	files.filter(fileIs).flatMap((f) =>
		[...f.source.matchAll(pattern)].flatMap((match) => {
			const message = reason(match, f);
			return message ? [`${f.path}: ${message}`] : [];
		}),
	);

const sameDomainParts = (
	imp: ArchitectureImport,
	domain: string | undefined,
): string[] | undefined =>
	domain && domainOf(imp.target) === domain ? partsOf(imp.target) : undefined;

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
	/(Body|Cache|Column|Consumer|Handle|Hub|Memory|Middleware|Options|PgBoss|Pool|Ports|Postgres|Reader|Redis|Repository|Responses|Routes|Schedule|Schema|Transaction)$/;
// The scope a file's exports start with: its package (packages/<name>/src) or Domain.
const scopeOf = (p: string): string | undefined => {
	const pkg = /^packages\/([^/]+)\/src\//.exec(p)?.[1];
	const domain = /(?:^|\/)src\/domains\/([^/]+)\//.exec(p)?.[1];
	const scope = pkg ?? domain;
	return scope ? camel(scope) : undefined;
};

export const architectureRules: Record<string, ArchitectureRule> = {
	A1: (files) =>
		importsCheck(
			files,
			(f) => businessIs(f.path) && !testIs(f.path),
			(imp, _f, domain) => {
				const parts = sameDomainParts(imp, domain);
				return parts?.[0] === "api" || parts?.[0] === "spi"
					? "business code never imports api/ or spi/; declare what it needs as a port in ports.ts and let the composition roots wire the adapter"
					: undefined;
			},
		),

	A2: (files) =>
		importsCheck(
			files,
			(f) => layerOf(f.path) === "rules" && !testIs(f.path),
			(imp, _f, domain) =>
				sameDomainParts(imp, domain)?.[0] === "models" ||
				(imp.target === "@n8io/baseline-authn" && imp.typeOnly)
					? undefined
					: "rules are pure functions over models/ (and the Actor type); move this to a use case in use-cases/",
		),

	A3: (files) =>
		importsCheck(
			files,
			(f) => layerOf(f.path) === "api" && !testIs(f.path),
			(imp, _f, domain) => {
				const parts = sameDomainParts(imp, domain);
				if (!parts) return undefined;
				if (parts[0] === "spi") {
					return "api/ never imports spi/; the composition roots pass use cases built on the adapters";
				}
				const allowed =
					(parts.length === 1 && parts[0] === "index.ts") ||
					parts[0] === "models" ||
					parts[0] === "api" ||
					(parts[0] === "use-cases" && imp.typeOnly);
				return allowed
					? undefined
					: "api/ reaches the domain only through its index.ts, models/ and use-case types";
			},
		),

	A4: (files) =>
		importsCheck(
			files,
			(f) => layerOf(f.path) === "spi" && !testIs(f.path),
			(imp, _f, domain) => {
				const parts = sameDomainParts(imp, domain);
				if (!parts || !domain) return undefined;
				const allowed =
					parts[0] === "models" ||
					parts[0] === "spi" ||
					(parts.length === 1 &&
						(parts[0] === "ports.ts" || parts[0] === `${domain}-errors.ts`));
				return allowed
					? undefined
					: `spi/ implements ports: from its domain it imports only ports.ts, models/ and ${domain}-errors.ts`;
			},
		),

	A5: (files) =>
		importsCheck(
			files,
			(f) => domainOf(f.path) === undefined,
			(imp) => {
				const target = domainOf(imp.target);
				if (!target) return undefined;
				const entry = partsOf(imp.target).join("/");
				return ["index.ts", "api/index.ts", "spi/index.ts"].includes(entry)
					? undefined
					: `outside a domain, import only src/domains/${target}/index.ts, api/index.ts or spi/index.ts; export what you need from one of them`;
			},
		),

	A6: (files) =>
		importsCheck(
			files,
			(f) => domainOf(f.path) !== undefined,
			(imp, f, domain) => {
				const target = domainOf(imp.target);
				if (!target || target === domain) return undefined;
				const consumer =
					layerOf(f.path) === "api" && f.path.endsWith("-consumer.ts");
				return consumer && partsOf(imp.target).join("/") === "index.ts"
					? undefined
					: `domains never import each other; read ${target} through a bridge in src/bridges/, or consume its event in api/${domain}-${target}-<event>-consumer.ts`;
			},
		),

	A7: (files) => [
		...importsCheck(
			files,
			(f) =>
				layerOf(f.path) === "models" ||
				f.path ===
					`src/domains/${domainOf(f.path)}/${domainOf(f.path)}-errors.ts`,
			(imp) =>
				imp.specifier.startsWith("@hono/")
					? "models and errors stay free of HTTP; put OpenAPI schemas in api/<domain>-routes.ts"
					: undefined,
		),
		...textCheck(
			files,
			(f) => layerOf(f.path) !== "api",
			/\.openapi\(/g,
			() =>
				".openapi( appears only in a domain's api/; put OpenAPI schemas and routes in api/<domain>-routes.ts",
		),
	],

	A8: (files) =>
		importsCheck(
			files,
			(f) => !testIs(f.path),
			(imp, f) => {
				if (imp.specifier.startsWith("@opentelemetry/")) {
					return "src/ never imports OpenTelemetry; use telemetrySpanAttributesSet and telemetrySpanRun from @n8io/baseline-telemetry/span";
				}
				return imp.specifier === "@n8io/baseline-telemetry/span" &&
					layerOf(f.path) !== "use-cases"
					? "only use cases touch spans; set span attributes in use-cases/, and wrap use cases with telemetryUseCasesTrace in the composition roots"
					: undefined;
			},
		),

	A9: (files) =>
		importsCheck(
			files,
			(f) =>
				(f.path.startsWith("src/domains/") || f.path.startsWith("src/ui/")) &&
				f.path !== "src/ui/entry.server.tsx",
			(imp) =>
				imp.specifier === "@n8io/baseline-logger"
					? "domains and the UI never log; return an error or set a span attribute, and log in the composition roots (src/ui/entry.server.tsx for page errors)"
					: undefined,
		),

	A10: (files) =>
		importsCheck(
			files,
			(f) =>
				(f.path.startsWith("src/ui/") || domainOf(f.path) !== undefined) &&
				!testIs(f.path),
			(imp, f) => {
				if (f.path.startsWith("src/ui/")) {
					const target = domainOf(imp.target);
					return target && partsOf(imp.target).join("/") !== "index.ts"
						? `the UI calls domains only through src/domains/${target}/index.ts; loaders and actions get use cases from the load context`
						: undefined;
				}
				return imp.target.startsWith("src/ui/")
					? "domains never import the UI; the UI calls the domain"
					: undefined;
			},
		),

	A11: (files) => {
		const bridges = files.filter(
			(f) => f.path.startsWith("src/bridges/") && !testIs(f.path),
		);
		const messages = bridges.flatMap((f) => {
			const domainImports = f.imports.filter((imp) => domainOf(imp.target));
			const entryMisses = domainImports
				.filter((imp) => partsOf(imp.target).join("/") !== "index.ts")
				.map(
					(imp) =>
						`${f.path} imports ${imp.specifier}: a bridge imports only each domain's index.ts`,
				);
			const domains = [
				...new Set(domainImports.flatMap((imp) => domainOf(imp.target) ?? [])),
			];
			const countMiss =
				domains.length === 2
					? []
					: [
							`${f.path}: a bridge connects exactly two domains through their index.ts; it imports ${domains.length} (${domains.join(", ") || "none"})`,
						];
			const callMisses = domains.flatMap((d) =>
				[
					...f.source.matchAll(
						new RegExp(`\\b(${camel(d)}[A-Z]\\w*)\\s*\\(`, "g"),
					),
				]
					.map((m) => m[1] ?? "")
					.filter((name) => !/(Get|List)$/.test(name))
					.map(
						(name) =>
							`${f.path}: a bridge only reads, so it calls only *Get and *List use cases, not ${name}; a change belongs in a use case of the domain that owns it`,
					),
			);
			return [...entryMisses, ...countMiss, ...callMisses];
		});
		const domainImports = importsCheck(
			files,
			(f) => domainOf(f.path) !== undefined,
			(imp) =>
				imp.target.startsWith("src/bridges/")
					? "no domain imports a bridge; the composition roots pass the bridge in as the domain's read port"
					: undefined,
		);
		return [...messages, ...domainImports];
	},

	A12: (files) => [
		...textCheck(
			files,
			(f) =>
				domainOf(f.path) !== undefined &&
				partsOf(f.path).join("/") === "ports.ts",
			/\bclose\s*\??\s*[(:<]/g,
			() =>
				"no port declares close; the composition roots open and close connections",
		),
		...textCheck(
			files,
			(f) => domainOf(f.path) !== undefined && !testIs(f.path),
			/\b(new Pool|createClient|postgresPoolCreate|redisClientCreate|queueCreate)\(/g,
			(m) =>
				`${m[1]}( opens a connection; the composition roots (src/server.ts, src/worker.ts, src/seed.ts) own connections and pass them to <domain>PortsCreate`,
		),
		...textCheck(
			files,
			(f) => domainOf(f.path) !== undefined && !testIs(f.path),
			/\bcacheStoreRedisCreate\(/g,
			() =>
				"cacheStoreRedisCreate( picks the cache's backend; src/cache-store-open.ts does that, and a Domain builds its cache on connections.cacheStore",
		),
		...textCheck(
			files,
			(f) =>
				!testIs(f.path) &&
				!/^src\/(connections|redis|[a-z-]+-open)\.ts$/.test(f.path),
			/\b(analyticsMixpanelCreate|cacheStoreRedisCreate|liveHubRedisCreate|postgresPoolCreate|pulsarCreate|queueCreate)\(/g,
			(m) =>
				`${m[1]}( picks a vendor and takes its settings; only src/connections.ts, src/redis.ts and the src/*-open.ts files do that`,
		),
	],

	A13: (files) => [
		...textCheck(
			files,
			(f) => !tableIs(f.path) && !testIs(f.path),
			/\bpgSchema\(|\bpgTable\(|\.table\(\s*["'`]/g,
			() => "tables live only in src/domains/<domain>/spi/<domain>-table.ts",
		),
		...textCheck(
			files,
			(f) => tableIs(f.path),
			/\bpgTable\b/g,
			(_m, f) =>
				`no bare pgTable; define tables with pgSchema("${snake(domainOf(f.path) ?? "")}").table(...)`,
		),
		...files
			.filter(
				(f) => tableIs(f.path) && !f.source.includes("// glossary-rename:"),
			)
			.flatMap((f) => {
				const schema = snake(domainOf(f.path) ?? "");
				return new RegExp(`\\bpgSchema\\(\\s*["'\`]${schema}["'\`]`).test(
					f.source,
				)
					? []
					: [
							`${f.path}: tables use pgSchema("${schema}"), named after the domain folder; mark a deliberate rename with // glossary-rename: <why>`,
						];
			}),
		...importsCheck(
			files,
			() => true,
			(imp, _f, domain) => {
				const owner = tableIs(imp.target) ? domainOf(imp.target) : undefined;
				return owner && owner !== domain
					? `another domain's table is private to ${owner}; read ${owner} through a bridge`
					: undefined;
			},
		),
	],

	A14: (files) => {
		const domains = domainsOf(files);
		return files
			.filter((f) => tableIs(f.path))
			.flatMap((f) => {
				const domain = domainOf(f.path) ?? "";
				const consumers = files.filter(
					(c) =>
						c.path.startsWith(`src/domains/${domain}/api/`) &&
						c.path.endsWith("-consumer.ts"),
				);
				return domains
					.filter(
						(other) =>
							other !== domain &&
							new RegExp(
								`["'\`]${snake(other)}_id["'\`]|\\b${camel(other)}Id\\s*:`,
							).test(f.source),
					)
					.filter(
						(other) =>
							!consumers.some((c) =>
								new RegExp(`["'\`]${other}\\.deleted["'\`]`).test(c.source),
							),
					)
					.map(
						(other) =>
							`${f.path}: a ${snake(other)}_id column needs src/domains/${domain}/api/${domain}-${other}-deleted-consumer.ts consuming "${other}.deleted", so rows never point at a deleted ${other}`,
					);
			});
	},

	A15: (files) =>
		textCheck(
			files,
			(f) => layerOf(f.path) === "spi",
			/\bsql\.raw\b/g,
			() =>
				"sql.raw is banned in spi/; build queries with Drizzle or the sql`` template, which binds parameters",
		),

	A16: (files) =>
		files
			.filter((f) => layerOf(f.path) === "use-cases" && !testIs(f.path))
			.flatMap((f) => {
				const domain = snake(domainOf(f.path) ?? "");
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
				const valid = new RegExp(
					`^baseline\\.${domain}\\.(id|[a-z][a-z0-9_]*_(id|count))$`,
				);
				return [...single, ...many]
					.filter((key) => !valid.test(key))
					.map(
						(key) =>
							`${f.path}: span attribute ${key} must be baseline.${domain}.id or baseline.${domain}.<thing>_id, or a baseline.${domain}.<thing>_count; never put names or other personal data on spans`,
					);
			}),

	A17: (files) =>
		textCheck(
			files,
			(f) =>
				f.path === "src/ui/routes.ts" ||
				(layerOf(f.path) === "api" &&
					!testIs(f.path) &&
					/-(routes|live)\.ts$/.test(f.path)),
			/(["'`])([^"'`\n]*\/[^"'`\n]*)\1/g,
			(m) => {
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
		),

	A18: (files) => {
		const domains = domainsOf(files);
		const server = files.find((f) => f.path === "src/server.ts");
		const mounted = domains
			.filter(
				(d) =>
					!server?.imports.some((imp) =>
						imp.target.startsWith(`src/domains/${d}/`),
					),
			)
			.map(
				(d) =>
					`src/server.ts: never imports src/domains/${d}; build its use cases and mount its routes there`,
			);
		const unwrapped = files
			.filter((f) => roots.includes(f.path))
			.flatMap((f) =>
				domains.flatMap((d) =>
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
		importsCheck(
			files,
			(f) =>
				domainOf(f.path) !== undefined &&
				layerOf(f.path) !== "spi" &&
				!testIs(f.path),
			(imp) =>
				/^src\/domains\/[^/]+\/spi\/.*\.memory\.ts$/.test(imp.target)
					? "only *.test.ts files (and spi/) import memory adapters; production code gets ports from <domain>PortsCreate in spi/index.ts"
					: undefined,
		),

	A20: (files) =>
		textCheck(
			files,
			(f) => domainOf(f.path) !== undefined,
			/@ts-(expect-error|ignore)\b/g,
			(m) => `@ts-${m[1]} is banned in src/domains/; fix the type instead`,
		),

	A21: (files) =>
		importsCheck(
			files,
			(f) => businessIs(f.path) && !testIs(f.path),
			(imp, f) => {
				const pkg = /^@n8io\/baseline-[^/]+/.exec(imp.specifier)?.[0];
				if (!pkg) return undefined;
				if (pkg === "@n8io/baseline-result" || pkg === "@n8io/baseline-id") {
					return undefined;
				}
				if (
					imp.specifier === "@n8io/baseline-telemetry/span" &&
					layerOf(f.path) === "use-cases"
				) {
					return undefined;
				}
				const typeAllowed =
					imp.typeOnly &&
					(pkg === "@n8io/baseline-queue" || pkg === "@n8io/baseline-authn") &&
					(partsOf(f.path).join("/") === "ports.ts" ||
						layerOf(f.path) === "rules" ||
						layerOf(f.path) === "use-cases");
				return typeAllowed
					? undefined
					: "business code imports only @n8io/baseline-result and @n8io/baseline-id, plus @n8io/baseline-telemetry/span in use-cases/ and `import type` of Inbox (queue) and Actor (authn) in ports.ts, rules/ and use-cases/; reach any other shared package through a port implemented in spi/";
			},
		),

	A22: (files) => [
		...importsCheck(
			files,
			(f) => !testIs(f.path),
			(imp, f) => {
				if (imp.specifier === "varlock/env" && f.path !== "src/env.ts") {
					return "only src/env.ts imports varlock/env; import ENV from #env in a composition root";
				}
				const rootsWithEnv = [...roots, "src/migrate.ts", "src/authn.ts"];
				return imp.target === "src/env.ts" && !rootsWithEnv.includes(f.path)
					? "only the composition roots and src/authn.ts read #env; pass the values in as arguments (the UI gets them from the load context)"
					: undefined;
			},
		),
		...textCheck(
			files,
			(f) => !testIs(f.path),
			/\bprocess\.env\b/g,
			() =>
				"process.env is read only through ENV from #env (declare the item in .env.schema)",
		),
	],

	A23: (files) => [
		...textCheck(
			files,
			() => true,
			exportedVerbFirst,
			([, name = "", verb = "", rest = ""]) =>
				exemptIs(name)
					? undefined
					: `${name} starts with a verb; name it generic to specific, scope then subject then action: ${rest.charAt(0).toLowerCase()}${rest.slice(1)}${verb.charAt(0).toUpperCase()}${verb.slice(1)}`,
		),
		...textCheck(
			files,
			() => true,
			exportedUntypedFunction,
			([, constName, functionName]) => {
				const name = constName ?? functionName ?? "";
				return !exemptIs(name) && thingWords.test(name)
					? `${name} builds and returns a thing; a factory ends in Create: ${name}Create`
					: undefined;
			},
		),
		...textCheck(
			files,
			() => true,
			exportedPredicate,
			([, constName, functionName]) => {
				const name = constName ?? functionName ?? "";
				return !exemptIs(name) && !/(Is|Has|Can)$/.test(name)
					? `${name} returns a boolean; a predicate ends in Is, Has or Can (barDeleteCan, barStaleIs)`
					: undefined;
			},
		),
		...textCheck(
			files,
			(f) => !testIs(f.path) && scopeOf(f.path) !== undefined,
			exportedFunction,
			([, constName, functionName], f) => {
				const name = constName ?? functionName ?? "";
				const scope = scopeOf(f.path) ?? "";
				return exemptIs(name) ||
					unscopedNames.has(name) ||
					new RegExp(`^${scope}(?:[A-Z0-9]|$)`).test(name)
					? undefined
					: `${name} is exported from ${scope}; start every exported function with its package or Domain name: ${scope}${name.charAt(0).toUpperCase()}${name.slice(1)}`;
			},
		),
	],

	A24: (files) =>
		importsCheck(
			files,
			(f) => !testIs(f.path) && !/(^|\/)test\//.test(f.path),
			(imp) =>
				/^@n8io\/baseline-[^/]+\/testing$/.test(imp.specifier)
					? "only *.test.ts(x) files and files under test/ import a Package's test helpers; production code imports @n8io/baseline-<package>, where its memory adapter is"
					: undefined,
		),
};
