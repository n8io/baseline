// node test/render/render-and-test.ts <directory>: builds the project CI's render-and-test job
// hands to app-ci.yml. origin/main is the previous release rendered as app-create renders it,
// with no domain yet; HEAD upgrades it to this checkout's apps/app with template-upgrade and
// checks, tests and builds it with no Domain, as app-create leaves a new Project. Then it adds
// Domains with this checkout's domain-create: customer with --bare first, invoice-line with
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

// Waits until npm serves the tarball of every @n8io/baseline-* package the project's lockfile
// resolved. On a release day the newest is seconds old: npm lists a version before its tarball
// answers, and the install fails with ERR_PNPM_TARBALL_HTTP_STATUS 404 (run 43596056438, 30 s to
// 2.5 min after the publish). pnpm asks only twice, at once, on a 404 whatever fetchRetries says;
// fetchRetries covers 5xx and network errors, so any answer but 404 is left to the install. Five
// minutes of 404 is a real failure, reported before the job's 10 minute limit.
const npmTarballsWait = async (directory: string): Promise<void> => {
	const lockfile = readFileSync(join(directory, "pnpm-lock.yaml"), "utf8");
	const urls = [
		...lockfile.matchAll(/^ {2}'?@n8io\/(baseline-[^@']+)@([^:'(]+)'?:$/gm),
	].map(
		([, name, version]) =>
			`https://registry.npmjs.org/@n8io/${name}/-/${name}-${version}.tgz`,
	);
	const deadline = Date.now() + 5 * 60_000;
	for (const url of new Set(urls)) {
		for (;;) {
			const status = await fetch(url, {
				method: "HEAD",
				signal: AbortSignal.timeout(10_000),
			}).then(
				(res) => res.status,
				() => undefined,
			);
			if (status !== 404) break;
			if (Date.now() > deadline) {
				throw new Error(`npm still answers 404 after 5 minutes for ${url}`);
			}
			console.log(`waiting for npm to serve ${url}`);
			await new Promise((resolve) => setTimeout(resolve, 15_000));
		}
	}
};

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
	await npmTarballsWait(directory);
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
