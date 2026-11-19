// node test/render/render-and-test.ts <directory>: builds the project CI's render-and-test job
// hands to app-ci.yml. origin/main is the previous release rendered as app-create renders it,
// with no domain yet; HEAD upgrades it to this checkout's apps/app with template-upgrade and
// checks, tests and builds it with no context, as app-create leaves a new Project. Then it adds
// contexts with this checkout's context-create, each with an Aggregate of its own name from
// aggregate-create: customer with --bare first, invoice-line with --bare and --reads customer, one
// --bare context per part, so each part passes app-ci alone and fills the wiring the first context
// left empty, and vendor with every part, which then gets a second Aggregate, vendor-contact, with
// every part too. Then the second-domain fixture: a customer_id column on invoice lines and the
// Event handler that clears it when a customer is deleted. HEAD installs this checkout's packages/*.
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	type AggregatePart,
	aggregateFilesCreate,
	aggregateRefusal,
	filesFormat,
	readsRefusal,
} from "../../apps/app/scripts/aggregate-create.ts";
import {
	contextFilesCreate,
	contextRefusal,
} from "../../apps/app/scripts/context-create.ts";
import { npmTarballsWait } from "../../apps/app/scripts/npm-tarballs-wait.ts";
import {
	filesWrite,
	releaseLatest,
	run,
	templateFetch,
	templateFinish,
} from "../../apps/app/scripts/template-render.ts";
import { templateUpgrade } from "../../apps/app/scripts/template-upgrade.ts";
import {
	answersWrite,
	appRender,
	gitCommitAll,
	glossaryTerm,
	pnpmRun,
	toolsDirectory,
} from "../../scripts/app-create.ts";
import {
	checkoutExport,
	checkoutPackagesTrack,
	checkoutPackagesUse,
	lockfileTemplateRequire,
} from "./checkout.ts";

const fixture = join(import.meta.dirname, "second-domain");

const answers = {
	description: "Invoices for render-and-test.",
	name: "render-test",
	release: "",
};
// customer first: invoice-line reads it through a Bridge. `parts` null is an aggregate-create
// without --bare. `context` names an existing context to add the Aggregate to; without it,
// context-create makes a context of the Aggregate's name first.
const domains: {
	context?: string;
	definition: string;
	kebab: string;
	parts: AggregatePart[] | null;
	plural: string;
	reads: string[];
}[] = [
	{
		definition: "Someone invoice lines are billed to.",
		kebab: "customer",
		parts: [],
		plural: "customers",
		reads: [],
	},
	{
		definition: "One charge on an invoice, which may name its customer.",
		kebab: "invoice-line",
		parts: [],
		plural: "invoice-lines",
		reads: ["customer"],
	},
	...(
		[
			["analytics", "badge"],
			["cache", "basket"],
			["live", "ticket"],
			["pages", "shipment"],
			["schedule", "payment"],
			["seed", "refund"],
		] as const
	).map(([part, kebab]) => ({
		definition: `A context made with aggregate-create --bare --${part}.`,
		kebab,
		parts: [part],
		plural: `${kebab}s`,
		reads: [],
	})),
	{
		definition: "Someone who sells to the shop.",
		kebab: "vendor",
		parts: null,
		plural: "vendors",
		reads: [],
	},
	{
		context: "vendor",
		definition: "A person to call at a vendor.",
		kebab: "vendor-contact",
		parts: null,
		plural: "vendor-contacts",
		reads: [],
	},
];

const main = async () => {
	const directory = resolve(process.argv[2] ?? "");
	if (process.argv[2] === undefined || existsSync(directory)) {
		throw new Error(
			"usage: node test/render/render-and-test.ts <new directory>",
		);
	}
	const previous = releaseLatest();
	const previousFiles = templateFetch(previous);
	const files = checkoutExport();
	const manifest = files.find((f) => f.path === "package.json")?.text ?? "{}";
	// Its own label: between releases the checkout's version equals the previous release's.
	const version = `${(JSON.parse(manifest) as { version: string }).version}-checkout`;

	console.log(`origin/main: app@${previous} with no domain`);
	await appRender({ directory, files: previousFiles, answers });
	answersWrite({
		directory,
		answers: { ...answers, release: previous },
		terms: domains.map((d) => ({
			definition: d.definition,
			term: glossaryTerm(d.kebab),
		})),
	});
	// The template's lockfile drops our own packages, so this install adds them, resolved first so
	// their tarballs can be awaited.
	pnpmRun(directory, ["install", "--lockfile-only", "--no-frozen-lockfile"]);
	await npmTarballsWait({ directory });
	pnpmRun(directory, ["install", "--no-frozen-lockfile"]);
	lockfileTemplateRequire(directory, previousFiles);
	gitCommitAll(directory, `Create render-test from app@${previous}`);
	run({
		command: "git",
		args: ["update-ref", "refs/remotes/origin/main", "HEAD"],
		options: {
			cwd: directory,
		},
	});

	console.log(`HEAD: template-upgrade to this checkout (${version})`);
	const { conflicts } = await templateUpgrade({
		appDirectory: directory,
		to: version,
		tools: {
			fetch: (release) => (release === version ? files : previousFiles),
			finish: (tree) => templateFinish(tree, toolsDirectory),
		},
	});
	if (conflicts.length > 0) {
		throw new Error(`template-upgrade conflicts: ${conflicts.join(", ")}`);
	}
	const upgraded = run({
		command: "git",
		args: ["status", "--porcelain"],
		options: { cwd: directory },
	});
	console.log(`template-upgrade changed:\n${upgraded || "(nothing)"}`);
	checkoutPackagesUse(directory);
	// template-upgrade leaves the project's lockfile alone, so the ranges this checkout changed
	// would resolve fresh. This project holds nothing beyond the template: start from its lockfile.
	writeFileSync(
		join(directory, "pnpm-lock.yaml"),
		files.find((f) => f.path === "pnpm-lock.yaml")?.text ?? "",
	);
	// The upgrade and the overrides change dependencies; CI's pnpm otherwise installs frozen.
	pnpmRun(directory, ["install", "--no-frozen-lockfile"]);
	lockfileTemplateRequire(directory, files);
	// app-create makes no Domain, so a Project's first commit is this tree.
	console.log("HEAD with no Domain: check, test and build");
	for (const script of ["check", "test", "build"]) pnpmRun(directory, [script]);

	for (const { context, kebab, parts, plural, reads } of domains) {
		const created: string[] = [];
		if (context === undefined) {
			const refusal =
				contextRefusal({ appDirectory: directory, context: kebab }) ??
				readsRefusal({
					appDirectory: directory,
					names: { kebab, plural: `${kebab}s` },
					reads,
				});
			if (refusal !== undefined) throw new Error(refusal);
			const contextFiles = contextFilesCreate({
				appDirectory: directory,
				context: kebab,
				reads,
				templateFull: files,
			});
			filesWrite(directory, contextFiles);
			created.push(...contextFiles.map((f) => f.path));
		}
		const aggregate = { kebab, plural };
		const refusal = aggregateRefusal({
			aggregate,
			appDirectory: directory,
			context: context ?? kebab,
		});
		if (refusal !== undefined) throw new Error(refusal);
		const aggregateFiles = aggregateFilesCreate({
			aggregate,
			appDirectory: directory,
			context: context ?? kebab,
			parts,
			templateFull: files,
		});
		filesWrite(directory, aggregateFiles);
		created.push(...aggregateFiles.map((f) => f.path));
		filesFormat({
			appDirectory: directory,
			paths: [...new Set(created)].filter((p) => !p.endsWith(".md")),
		});
	}
	if (process.env.RENDER_AND_TEST_STOP === "fixture") {
		// To change the fixture: edit this tree, then copy its new files to second-domain/files
		// and save `git diff` as second-domain/wiring.patch.
		gitCommitAll(directory, "Add the contexts");
		return;
	}
	cpSync(join(fixture, "files"), directory, { recursive: true });
	run({
		command: "git",
		args: ["apply", "--whitespace=nowarn", join(fixture, "wiring.patch")],
		options: {
			cwd: directory,
		},
	});
	pnpmRun(directory, ["exec", "biome", "check", "--write", "."]);
	pnpmRun(directory, ["codegen"]);
	pnpmRun(directory, ["check"]);
	pnpmRun(directory, ["test"]);
	checkoutPackagesTrack(directory);
	gitCommitAll(directory, "Upgrade and add the contexts");
	console.log(readFileSync(join(directory, ".template.json"), "utf8"));
};

await main();
