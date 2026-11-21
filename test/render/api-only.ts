// node test/render/api-only.ts <directory> [case]: renders this checkout's apps/app as app-create
// does, with the customer context, and drives the rendered Project's own `pnpm piece-remove`:
// - each of ui, live, cache, queue, analytics, error-tracking, api-reference and cli removed alone, and sdk
//   after cli, passes check, unit tests and build, and git revert of its commits gives back the starting tree;
// - redis alone is refused, because the cache and live updates run on it, and sdk alone, because the cli runs on it;
// - all ten removed together, each passing check, then reverted, give back the starting tree,
//   which passes check unchanged;
// - all ten removed, then invoice-line added with context-create and aggregate-create, pass check, unit tests and build
//   and the built server serves the API with its security guards.
// With no case, one render serves every check. CI runs one render per case so they run side by side:
// alone-1 (ui, live, cache, queue), alone-2 (analytics, error-tracking, api-reference, cli then sdk) and
// all (the refusals, every piece together, and the served API). `pnpm piece-check` is not one of them:
// render-and-test's `pieces` job runs it on the render that job checks.
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
	aggregateFilesCreate,
	aggregateRefusal,
} from "../../apps/app/scripts/aggregate-create.ts";
import {
	contextFilesCreate,
	contextRefusal,
} from "../../apps/app/scripts/context-create.ts";
import { gitRun, processRun } from "../../apps/app/scripts/process-run.ts";
import { filesWrite } from "../../apps/app/scripts/template-render.ts";
import {
	answersWrite,
	appRender,
	gitCommitAll,
	glossaryTerm,
	pnpmInheritRun,
} from "../../scripts/app-create.ts";
import {
	checkoutExport,
	checkoutPackagesUse,
	lockfileTemplateRequire,
} from "./checkout.ts";
import { glossaryContextMapDefine, glossaryTermAdd } from "./glossary.ts";

const answers = { description: "An API without pages.", name: "api-only" };
const customer = {
	definition: "Someone invoice lines are billed to.",
	kebab: "customer",
	plural: "customers",
};
const invoiceLine = {
	definition: "One charge on an invoice.",
	kebab: "invoice-line",
	plural: "invoice-lines",
};
type Piece =
	| "analytics"
	| "api-reference"
	| "cache"
	| "cli"
	| "error-tracking"
	| "live"
	| "queue"
	| "redis"
	| "sdk"
	| "ui";

const contextAdd = ({
	directory,
	files,
	names,
}: {
	directory: string;
	files: ReturnType<typeof checkoutExport>;
	names: typeof customer;
}) => {
	glossaryContextMapDefine({ context: names.kebab, directory });
	const refusal = contextRefusal({
		appDirectory: directory,
		context: names.kebab,
	});
	if (refusal !== undefined) throw new Error(refusal);
	const shell = contextFilesCreate({
		appDirectory: directory,
		context: names.kebab,
		templateFull: files,
	});
	filesWrite(directory, shell);
	glossaryTermAdd({
		context: names.kebab,
		definition: names.definition,
		directory,
		term: glossaryTerm(names.kebab),
	});
	const refused = aggregateRefusal({
		aggregate: names,
		appDirectory: directory,
		context: names.kebab,
	});
	if (refused !== undefined) throw new Error(refused);
	const aggregate = aggregateFilesCreate({
		aggregate: names,
		appDirectory: directory,
		context: names.kebab,
		templateFull: files,
	});
	filesWrite(directory, aggregate);
	const created = [...shell, ...aggregate].filter(
		(f) => !f.path.endsWith(".md"),
	);
	const paths = created.map((f) => f.path);
	const unusedImports = "--only=correctness/noUnusedImports";
	pnpmInheritRun(directory, [
		"exec",
		"biome",
		"lint",
		"--write",
		"--unsafe",
		unusedImports,
		...paths,
	]);
	// The map's new row and the context's language, as a Project's pnpm format leaves them.
	const glossaries = [
		"CONTEXT-MAP.md",
		`src/contexts/${names.kebab}/CONTEXT.md`,
	];
	pnpmInheritRun(directory, [
		"exec",
		"biome",
		"check",
		"--write",
		...paths,
		...glossaries,
	]);
};

type OpenApiDocument = {
	components?: { securitySchemes?: { bearer?: unknown } };
	paths: Record<string, Record<string, { security?: unknown }>>;
	security?: unknown;
};

const guardFail = (what: string, res: Response) => {
	throw new Error(
		`the served API ${what}: ${res.status} ${JSON.stringify([...res.headers])}`,
	);
};

// The guards test/integration/server-wiring.test.ts proves on the production build, once more through
// @hono/node-server: the CSP and secure headers, 401 before a route reads the body, httpCsrf
// on sign-in, the __Host- session cookie, and the OpenAPI document's bearer scheme.
const apiGuardsRequire = async ({
	doc,
	openapi,
	url,
}: {
	doc: OpenApiDocument;
	openapi: Response;
	url: string;
}) => {
	const csp = /^base-uri 'self'; default-src 'self'; .*'nonce-/;
	const anonymous = await fetch(`${url}/api/v1/invoice-lines`, {
		body: "{not json",
		headers: { "content-type": "application/json" },
		method: "POST",
	});
	for (const res of [openapi, anonymous]) {
		if (
			!csp.test(res.headers.get("content-security-policy") ?? "") ||
			res.headers.get("x-content-type-options") !== "nosniff" ||
			!res.headers.get("strict-transport-security")?.startsWith("max-age=")
		) {
			guardFail("sent no CSP or secure headers", res);
		}
	}
	if (anonymous.status !== 401)
		guardFail("let an anonymous post in", anonymous);
	// The document declares the bearer scheme and requires it on every operation: no operation
	// opts out with its own `security`.
	const operations = Object.values(doc.paths).flatMap((path) =>
		Object.values(path),
	);
	if (
		!isDeepStrictEqual(doc.components?.securitySchemes?.bearer, {
			bearerFormat: "JWT",
			scheme: "bearer",
			type: "http",
		}) ||
		!isDeepStrictEqual(doc.security, [{ bearer: [] }]) ||
		operations.some((operation) => operation.security !== undefined)
	) {
		throw new Error(
			`the served API does not require the bearer scheme on every operation: ${JSON.stringify({ scheme: doc.components?.securitySchemes?.bearer, security: doc.security })}`,
		);
	}
	// The docs exemption stays in base code: without the piece the page is the API's JSON 404.
	const docs = await fetch(`${url}/api/v1/docs`);
	if (
		docs.status !== 404 ||
		!(docs.headers.get("content-type") ?? "").includes("json")
	) {
		guardFail("answered /api/v1/docs with something but a JSON 404", docs);
	}
	const signIn = (origin: string) =>
		fetch(`${url}/auth/sign-in`, {
			body: new URLSearchParams({ who: "dev-user" }),
			headers: { origin },
			method: "POST",
			redirect: "manual",
		});
	const crossSite = await signIn("https://evil.example");
	if (crossSite.status !== 403)
		guardFail("took a cross-site sign-in", crossSite);
	const signedIn = await signIn(url);
	const cookie = signedIn.headers
		.getSetCookie()
		.find((line) => line.startsWith("__Host-authn="));
	const flags = ["HttpOnly", "Path=/", "SameSite=Lax", "Secure"];
	const attributes = cookie?.split(/;\s*/) ?? [];
	if (
		!flags.every((flag) => attributes.includes(flag)) ||
		attributes.some((a) => a.startsWith("Domain="))
	) {
		guardFail("set no __Host- session cookie", signedIn);
	}
};

// Serves build/server/index.js on memory adapters, asks for the OpenAPI document and checks the
// guards on what it serves.
const apiServe = async (directory: string) => {
	const port = 3_100 + Math.floor(Math.random() * 800);
	const server = spawn(
		"node",
		["--import", "./src/preload.ts", "build/server/index.js"],
		{
			cwd: directory,
			env: {
				...process.env,
				APP_ENV: "test",
				HEALTH_PORT: String(port + 1),
				PORT: String(port),
			},
			stdio: "inherit",
		},
	);
	try {
		const deadline = Date.now() + 20_000;
		for (;;) {
			const res = await fetch(
				`http://127.0.0.1:${port}/api/v1/openapi.json`,
			).catch(() => undefined);
			if (res?.status === 200) {
				const doc = (await res.json()) as OpenApiDocument;
				if (!("/api/v1/invoice-lines" in doc.paths)) {
					throw new Error("the served API has no /api/v1/invoice-lines");
				}
				await apiGuardsRequire({
					doc,
					openapi: res,
					url: `http://127.0.0.1:${port}`,
				});
				return;
			}
			if (Date.now() > deadline || server.exitCode !== null) {
				throw new Error("the built server never served /api/v1/openapi.json");
			}
			await new Promise((r) => setTimeout(r, 200));
		}
	} finally {
		server.kill("SIGTERM");
		if (server.exitCode === null) await once(server, "exit");
	}
};

const git = (directory: string, args: string[]): string =>
	gitRun(directory, args).trim();

// As pieces.md says: remove, then the checks the command prints (only check when every piece
// goes), then commit, so the commit carries what check regenerates.
const pieceRemove = ({
	directory,
	piece,
	scripts,
}: {
	directory: string;
	piece: Piece;
	scripts: string[];
}) => {
	console.log(`pnpm piece-remove ${piece}`);
	pnpmInheritRun(directory, ["piece-remove", piece]);
	for (const script of scripts) pnpmInheritRun(directory, [script]);
	gitCommitAll(directory, `Remove ${piece}`);
};

const treeCleanRequire = (directory: string, after: string) => {
	const status = git(directory, ["status", "--porcelain"]);
	if (status !== "") throw new Error(`${after} changed the tree:\n${status}`);
};

// Reverts the commits after `before`, newest first, and requires the tree `before` had.
const revertTo = (directory: string, before: string) => {
	git(directory, ["revert", "--no-edit", `${before}..HEAD`]);
	const diff = git(directory, ["diff", "--stat", before, "HEAD"]);
	if (diff !== "") throw new Error(`git revert left a diff:\n${diff}`);
	pnpmInheritRun(directory, ["install"]);
	treeCleanRequire(directory, "pnpm install after the revert");
};

const casesOf = { all: 0, "alone-1": 0, "alone-2": 0 };

const checkTestBuild = ["check", "test", "build"];

const main = async () => {
	const directory = resolve(process.argv[2] ?? "");
	const only = process.argv[3];
	if (
		process.argv[2] === undefined ||
		existsSync(directory) ||
		(only !== undefined && !(only in casesOf))
	) {
		throw new Error(
			`usage: node test/render/api-only.ts <new directory> [${Object.keys(casesOf).join("|")}]`,
		);
	}
	const run = (name: keyof typeof casesOf) =>
		only === undefined || only === name;
	const files = checkoutExport();
	await appRender({ directory, files, answers });
	answersWrite({ directory, answers: { ...answers, release: "checkout" } });
	processRun({
		command: "git",
		args: ["init", "--quiet", "--initial-branch=main"],
		options: { cwd: directory },
	});
	checkoutPackagesUse(directory);
	pnpmInheritRun(directory, ["install", "--no-frozen-lockfile"]);
	lockfileTemplateRequire(directory, files);
	contextAdd({ directory, files, names: customer });
	pnpmInheritRun(directory, ["check"]);
	gitCommitAll(directory, "Create api-only with customer");
	const head = () => git(directory, ["rev-parse", "HEAD"]);

	const alone = [
		...(run("alone-1") ? (["ui", "live", "cache", "queue"] as const) : []),
		...(run("alone-2")
			? (["analytics", "error-tracking", "api-reference"] as const)
			: []),
	];
	for (const piece of alone) {
		const before = head();
		pieceRemove({ directory, piece, scripts: checkTestBuild });
		revertTo(directory, before);
		console.log(
			`api-only: ${piece} alone passes check, test and build, and reverts`,
		);
	}

	if (run("alone-2")) {
		// The CLI runs on the SDK: cli alone, then sdk after it, each passing check, test and build.
		const clientsBefore = head();
		for (const piece of ["cli", "sdk"] as const) {
			pieceRemove({ directory, piece, scripts: checkTestBuild });
		}
		revertTo(directory, clientsBefore);
		console.log(
			"api-only: cli alone, then sdk, pass check, test and build, and revert",
		);
	}

	if (!run("all")) return;

	const refused = spawnSync("pnpm", ["piece-remove", "redis"], {
		cwd: directory,
		encoding: "utf8",
	});
	if (refused.status === 0 || !refused.stderr.includes("Remove the cache")) {
		throw new Error(`piece-remove redis was not refused:\n${refused.stderr}`);
	}
	treeCleanRequire(directory, "the refused piece-remove redis");
	const sdkRefused = spawnSync("pnpm", ["piece-remove", "sdk"], {
		cwd: directory,
		encoding: "utf8",
	});
	if (
		sdkRefused.status === 0 ||
		!sdkRefused.stderr.includes("Remove the cli")
	) {
		throw new Error(`piece-remove sdk was not refused:\n${sdkRefused.stderr}`);
	}
	treeCleanRequire(directory, "the refused piece-remove sdk");

	const before = head();
	const all: Piece[] = [
		"live",
		"ui",
		"cache",
		"redis",
		"queue",
		"analytics",
		"error-tracking",
		"api-reference",
		"cli",
		"sdk",
	];
	for (const piece of all)
		pieceRemove({ directory, piece, scripts: ["check"] });
	const removed = head();
	revertTo(directory, before);
	pnpmInheritRun(directory, ["check"]);
	treeCleanRequire(directory, "check after the revert");
	console.log("api-only: every piece removed, then reverted, passes check");

	git(directory, ["reset", "--hard", "--quiet", removed]);
	// git ignores the types check generated after the revert; piece-remove ui deletes them.
	rmSync(join(directory, ".react-router"), { force: true, recursive: true });
	pnpmInheritRun(directory, ["install"]);
	contextAdd({ directory, files, names: invoiceLine });
	for (const script of checkTestBuild) pnpmInheritRun(directory, [script]);
	await apiServe(directory);
	gitCommitAll(directory, "Add invoice-line");
	console.log("api-only: check, test, build and the served API pass");
};

await main();
