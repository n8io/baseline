// node test/render/render-and-test.ts <directory>: builds the project CI's render-and-test job
// hands to app-ci.yml. origin/main is the previous release rendered as app-create renders it,
// with no domain yet; HEAD upgrades it to this checkout's apps/app with template-upgrade, then
// adds Domains with this checkout's domain-create: customer with --bare first, invoice-line with
// --bare --reads customer, one --bare Domain per part, so each part passes app-ci alone and fills
// the wiring the first Domain left empty, and vendor with every part. Then
// the second-domain fixture: a customer_id column on invoice lines and the consumer that clears it
// when a customer is deleted. HEAD installs this checkout's packages/*.
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	type DomainPart,
	domainFilesCreate,
	domainFilesFormat,
	domainNameRefusal,
	domainReadsRefusal,
} from "../../apps/app/scripts/domain-create.ts";
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
// customer first: invoice-line reads it through a Bridge. `parts` null is a domain-create
// without --bare.
const domains: {
	definition: string;
	kebab: string;
	parts: DomainPart[] | null;
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
		definition: `A Domain made with domain-create --bare --${part}.`,
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
	// The template's lockfile drops our own packages, so this install adds them.
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

	for (const { kebab, parts, plural, reads } of domains) {
		const names = { kebab, plural };
		const refusal =
			domainNameRefusal(names, directory) ??
			domainReadsRefusal({ appDirectory: directory, names, reads });
		if (refusal !== undefined) throw new Error(refusal);
		const created = domainFilesCreate({
			templateFull: files,
			appDirectory: directory,
			names,
			parts,
			reads,
		});
		filesWrite(directory, created);
		domainFilesFormat({
			appDirectory: directory,
			paths: created.map((f) => f.path),
		});
	}
	if (process.env.RENDER_AND_TEST_STOP === "fixture") {
		// To change the fixture: edit this tree, then copy its new files to second-domain/files
		// and save `git diff` as second-domain/wiring.patch.
		gitCommitAll(directory, "Add the Domains");
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
	gitCommitAll(directory, "Upgrade and add the Domains");
	console.log(readFileSync(join(directory, ".template.json"), "utf8"));
};

await main();
