// node test/render/api-only.ts <directory>: renders this checkout's apps/app as app-create
// does, with the customer Domain, and drives the rendered Project's own `pnpm piece-remove`:
// - each of ui, live, cache and queue removed alone passes check, unit tests and build, and
//   git revert of its commit gives back the starting tree;
// - redis alone is refused, because the cache and live updates run on it;
// - all five removed together, each passing check, then reverted, give back the starting tree,
//   which passes check unchanged;
// - all five removed, then invoice-line added with domain-create, pass check, unit tests and build
//   and the built server serves the API.
// One render serves every case, to keep CI short.
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
	domainFilesCreate,
	domainNameRefusal,
} from "../../apps/app/scripts/domain-create.ts";
import { filesWrite, run } from "../../apps/app/scripts/template-render.ts";
import {
	answersWrite,
	appRender,
	gitCommitAll,
	glossaryTerm,
	pnpmRun,
} from "../../scripts/app-create.ts";
import { checkoutExport, checkoutPackagesUse } from "./checkout.ts";

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
type Piece = "cache" | "live" | "queue" | "redis" | "ui";

const domainAdd = (
	directory: string,
	files: ReturnType<typeof checkoutExport>,
	names: typeof customer,
) => {
	const refusal = domainNameRefusal(names, directory);
	if (refusal !== undefined) throw new Error(refusal);
	const created = domainFilesCreate(files, directory, names);
	filesWrite(directory, created);
	const paths = created.map((f) => f.path);
	const unusedImports = "--only=correctness/noUnusedImports";
	pnpmRun(directory, [
		"exec",
		"biome",
		"lint",
		"--write",
		"--unsafe",
		unusedImports,
		...paths,
	]);
	pnpmRun(directory, ["exec", "biome", "check", "--write", ...paths]);
};

// Serves build/server/index.js on memory adapters and asks for the OpenAPI document.
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
				const doc = (await res.json()) as { paths: Record<string, unknown> };
				if (!("/api/v1/invoice-lines" in doc.paths)) {
					throw new Error("the served API has no /api/v1/invoice-lines");
				}
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
	run("git", args, { cwd: directory }).trim();

// As pieces.md says: remove, then the checks the command prints (only check when every piece
// goes), then commit, so the commit carries what check regenerates.
const pieceRemove = (directory: string, piece: Piece, scripts: string[]) => {
	console.log(`pnpm piece-remove ${piece}`);
	pnpmRun(directory, ["piece-remove", piece]);
	for (const script of scripts) pnpmRun(directory, [script]);
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
	pnpmRun(directory, ["install"]);
	treeCleanRequire(directory, "pnpm install after the revert");
};

const checkTestBuild = ["check", "test", "build"];

const main = async () => {
	const directory = resolve(process.argv[2] ?? "");
	if (process.argv[2] === undefined || existsSync(directory)) {
		throw new Error("usage: node test/render/api-only.ts <new directory>");
	}
	const files = checkoutExport();
	await appRender(directory, files, answers);
	answersWrite(
		directory,
		{ ...answers, release: "checkout" },
		[customer, invoiceLine].map((d) => ({
			definition: d.definition,
			term: glossaryTerm(d.kebab),
		})),
	);
	run("git", ["init", "--quiet", "--initial-branch=main"], { cwd: directory });
	checkoutPackagesUse(directory);
	pnpmRun(directory, ["install"]);
	domainAdd(directory, files, customer);
	pnpmRun(directory, ["check"]);
	gitCommitAll(directory, "Create api-only with customer");
	const head = () => git(directory, ["rev-parse", "HEAD"]);

	for (const piece of ["ui", "live", "cache", "queue"] as const) {
		const before = head();
		pieceRemove(directory, piece, checkTestBuild);
		revertTo(directory, before);
		console.log(
			`api-only: ${piece} alone passes check, test and build, and reverts`,
		);
	}

	const refused = spawnSync("pnpm", ["piece-remove", "redis"], {
		cwd: directory,
		encoding: "utf8",
	});
	if (refused.status === 0 || !refused.stderr.includes("Remove the cache")) {
		throw new Error(`piece-remove redis was not refused:\n${refused.stderr}`);
	}
	treeCleanRequire(directory, "the refused piece-remove redis");

	const before = head();
	const all: Piece[] = ["live", "ui", "cache", "redis", "queue"];
	for (const piece of all) pieceRemove(directory, piece, ["check"]);
	const removed = head();
	revertTo(directory, before);
	pnpmRun(directory, ["check"]);
	treeCleanRequire(directory, "check after the revert");
	console.log("api-only: every piece removed, then reverted, passes check");

	git(directory, ["reset", "--hard", "--quiet", removed]);
	pnpmRun(directory, ["install"]);
	domainAdd(directory, files, invoiceLine);
	for (const script of checkTestBuild) pnpmRun(directory, [script]);
	await apiServe(directory);
	gitCommitAll(directory, "Add invoice-line");
	console.log("api-only: check, test, build and the served API pass");
};

await main();
