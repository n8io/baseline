// node test/render/render-and-test.ts <directory>: builds the project CI's render-and-test job
// hands to app-ci.yml. origin/main is the previous release rendered as app-create renders it,
// with no context yet; HEAD upgrades it to this checkout's apps/app with template-upgrade and
// checks, tests and builds it with no context, as app-create leaves a new Project. Then it adds
// contexts with this checkout's context-create, each with a Model of its own name from
// model-create: customer with --bare first, invoice-line with --bare and --reads customer, one
// --bare context per option, so each option passes app-ci alone and fills the wiring the first context
// left empty, and vendor with every option, which then gets a second Model, vendor-contact, with
// every option too. Then the second-context fixture: a customer_id column on invoice lines and the
// Event handler that clears it when a customer is deleted. HEAD installs this checkout's packages/*.
import {
	cpSync,
	existsSync,
	mkdtempDisposableSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	contextFilesCreate,
	contextRefusal,
} from "../../apps/app/scripts/context-create.ts";
import {
	filesFormat,
	type ModelOption,
	modelFilesCreate,
	modelRefusal,
	readsRefusal,
} from "../../apps/app/scripts/model-create.ts";
import { npmTarballsWait } from "../../apps/app/scripts/npm-tarballs-wait.ts";
import { processRun } from "../../apps/app/scripts/process-run.ts";
import {
	filesWrite,
	releaseLatest,
	templateFetch,
	templateFinish,
} from "../../apps/app/scripts/template-render.ts";
import { templateUpgrade } from "../../apps/app/scripts/template-upgrade.ts";
import {
	answersWrite,
	appRender,
	gitCommitAll,
	glossaryTerm,
	pnpmInheritRun,
	toolsDirectory,
} from "../../scripts/app-create.ts";
import {
	checkoutExport,
	checkoutPackagesTrack,
	checkoutPackagesUse,
	lockfileTemplateRequire,
} from "./checkout.ts";
import { glossaryContextMapDefine, glossaryTermAdd } from "./glossary.ts";

const fixture = join(import.meta.dirname, "second-context");

const answers = {
	description: "Invoices for render-and-test.",
	name: "render-test",
	release: "",
};
// customer first: invoice-line reads it through an anti-corruption layer. `options` null is a model-create
// without --bare. `context` names an existing context to add the Model to; without it,
// context-create makes a context of the Model's name first.
const contexts: {
	context?: string;
	definition: string;
	kebab: string;
	options: ModelOption[] | null;
	plural: string;
	reads: string[];
}[] = [
	{
		definition: "Someone invoice lines are billed to.",
		kebab: "customer",
		options: [],
		plural: "customers",
		reads: [],
	},
	{
		definition: "One charge on an invoice, which may name its customer.",
		kebab: "invoice-line",
		options: [],
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
	).map(([option, kebab]) => ({
		definition: `A context made with model-create --bare --${option}.`,
		kebab,
		options: [option],
		plural: `${kebab}s`,
		reads: [],
	})),
	{
		definition: "Someone who sells to the shop.",
		kebab: "vendor",
		options: null,
		plural: "vendors",
		reads: [],
	},
	{
		context: "vendor",
		definition: "A person to call at a vendor.",
		kebab: "vendor-contact",
		options: null,
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

	console.log(`origin/main: app@${previous} with no context`);
	await appRender({ directory, files: previousFiles, answers });
	answersWrite({ directory, answers: { ...answers, release: previous } });
	// The template's lockfile drops our own packages, so this install adds them, resolved first so
	// their tarballs can be awaited.
	pnpmInheritRun(directory, [
		"install",
		"--lockfile-only",
		"--no-frozen-lockfile",
	]);
	await npmTarballsWait({ directory });
	pnpmInheritRun(directory, ["install", "--no-frozen-lockfile"]);
	lockfileTemplateRequire(directory, previousFiles);
	gitCommitAll(directory, `Create render-test from app@${previous}`);
	processRun({
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
	const upgraded = processRun({
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
	pnpmInheritRun(directory, ["install", "--no-frozen-lockfile"]);
	lockfileTemplateRequire(directory, files);
	// app-create makes no bounded context, so a Project's first commit is this tree.
	console.log("HEAD with no bounded context: check, test and build");
	for (const script of ["check", "test", "build"])
		pnpmInheritRun(directory, [script]);
	// A fresh render writes the SDK as pnpm sdk-generate does for a Project with no bounded context.
	// template-upgrade keeps a Project's own generated SDK files, so compare a render of this checkout
	// with what the generator writes here; a Project runs it after an upgrade, as this one does now.
	const sdkFiles = ["clients/sdk/openapi.json", "clients/sdk/sdk.ts"];
	const sdkRead = (root: string) =>
		sdkFiles.map((path) => readFileSync(join(root, path), "utf8"));
	using fresh = mkdtempDisposableSync(join(tmpdir(), "render-fresh-"));
	await appRender({ directory: fresh.path, files, answers });
	const sdkRendered = sdkRead(fresh.path);
	pnpmInheritRun(directory, ["sdk-generate"]);
	const sdkChanged = sdkRead(directory).flatMap((text, k) =>
		text === sdkRendered[k] ? [] : [sdkFiles[k]],
	);
	if (sdkChanged.length > 0) {
		throw new Error(
			`pnpm sdk-generate changed the rendered ${sdkChanged.join(" and ")}: the render (sdkFileRender in template-render.ts) and the generator disagree`,
		);
	}

	for (const {
		context,
		definition,
		kebab,
		options,
		plural,
		reads,
	} of contexts) {
		const created: string[] = [];
		if (context === undefined) {
			glossaryContextMapDefine({ context: kebab, directory });
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
		glossaryTermAdd({
			context: context ?? kebab,
			definition,
			directory,
			term: glossaryTerm(kebab),
		});
		const model = { kebab, plural };
		const refusal = modelRefusal({
			model,
			appDirectory: directory,
			context: context ?? kebab,
		});
		if (refusal !== undefined) throw new Error(refusal);
		const modelFiles = modelFilesCreate({
			model,
			appDirectory: directory,
			context: context ?? kebab,
			options,
			templateFull: files,
		});
		filesWrite(directory, modelFiles);
		created.push(...modelFiles.map((f) => f.path));
		filesFormat({
			appDirectory: directory,
			paths: [...new Set(created)].filter((p) => !p.endsWith(".md")),
		});
	}
	if (process.env["RENDER_AND_TEST_STOP"] === "fixture") {
		// To change the fixture: edit this tree, then copy its new files to second-context/files
		// and save `git diff` as second-context/wiring.patch.
		gitCommitAll(directory, "Add the contexts");
		return;
	}
	cpSync(join(fixture, "files"), directory, { recursive: true });
	processRun({
		command: "git",
		args: ["apply", "--whitespace=nowarn", join(fixture, "wiring.patch")],
		options: {
			cwd: directory,
		},
	});
	pnpmInheritRun(directory, ["exec", "biome", "check", "--write", "."]);
	pnpmInheritRun(directory, ["codegen"]);
	// The contexts added routes, so the SDK is regenerated, as a Project does after model-create.
	pnpmInheritRun(directory, ["sdk-generate"]);
	pnpmInheritRun(directory, ["check"]);
	pnpmInheritRun(directory, ["test"]);
	checkoutPackagesTrack(directory);
	gitCommitAll(directory, "Upgrade and add the contexts");
	console.log(readFileSync(join(directory, ".template.json"), "utf8"));
};

await main();
