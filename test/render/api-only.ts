// node test/render/api-only.ts <directory>: renders this checkout's apps/app as app-create
// does, with the customer Domain, then removes live updates, the UI pages, the cache, Redis and
// the queue by running the steps in the rendered docs/agents/pieces.md exactly as written, adds
// invoice-line with domain-create, and requires check, unit tests, build and a served API.
// A second render in <directory>-queue removes the queue with every other piece in place, then
// the cache, and requires check, unit tests and build; one render covers both, to keep CI short.
// The doc is the only copy of the steps, so it cannot drift from what this proves.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
// Each piece's heading in pieces.md; its first sh block is the removal.
const pieceHeadings = {
	cache: "## The cache",
	live: "## Live updates",
	queue: "## The queue and the Worker",
	redis: "## Redis",
	ui: "## UI pages",
};
type Piece = keyof typeof pieceHeadings;

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

const removalStepsFind = (doc: string, heading: string): string => {
	const section = doc.split(`\n${heading}\n`)[1]?.split("\n## ")[0];
	const steps = section?.match(/```sh\n([\s\S]*?)\n```/)?.[1];
	if (steps === undefined) {
		throw new Error(`pieces.md has no sh block under "${heading}"`);
	}
	return steps;
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

// Renders a Project with customer, removes the pieces in order, then adds invoice-line.
const projectWithout = async (
	directory: string,
	files: ReturnType<typeof checkoutExport>,
	removed: Piece[],
) => {
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
	gitCommitAll(directory, "Create api-only with customer");

	const doc = readFileSync(join(directory, "docs/agents/pieces.md"), "utf8");
	for (const piece of removed) {
		const heading = pieceHeadings[piece];
		console.log(`Removing ${piece} with the steps under "${heading}"`);
		run("bash", ["-euo", "pipefail", "-c", removalStepsFind(doc, heading)], {
			cwd: directory,
			inherit: true,
		});
		const left = run(
			"bash",
			[
				"-c",
				`git grep -lE '^[[:space:]]*(//|#) piece-start: ${piece}$' || true`,
			],
			{ cwd: directory },
		).trim();
		if (left !== "")
			throw new Error(`piece-start: ${piece} is left in ${left}`);
		gitCommitAll(directory, `Remove ${piece}`);
	}

	domainAdd(directory, files, invoiceLine);
	pnpmRun(directory, ["check"]);
	pnpmRun(directory, ["test"]);
	pnpmRun(directory, ["build"]);
};

const main = async () => {
	const directory = resolve(process.argv[2] ?? "");
	const queueFirst = `${directory}-queue`;
	if (
		process.argv[2] === undefined ||
		existsSync(directory) ||
		existsSync(queueFirst)
	) {
		throw new Error("usage: node test/render/api-only.ts <new directory>");
	}
	const files = checkoutExport();
	await projectWithout(directory, files, [
		"live",
		"ui",
		"cache",
		"redis",
		"queue",
	]);
	await apiServe(directory);
	gitCommitAll(directory, "Add invoice-line");
	console.log("api-only: check, test, build and the served API pass");

	await projectWithout(queueFirst, files, ["queue", "cache"]);
	console.log(
		"api-only without the queue, then the cache: check, test and build pass",
	);
};

await main();
