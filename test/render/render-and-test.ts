// node test/render/render-and-test.ts <directory>: builds the project CI's render-and-test job
// hands to app-ci.yml. origin/main is the previous release rendered as app-create renders it,
// with no domain yet; HEAD upgrades it to this checkout's apps/app with template-upgrade, then
// adds invoice-line and customer with this checkout's domain-create, and the second-domain
// fixture: a customer_id column on invoice lines, the consumer that clears it when a customer is
// deleted, and the bridge that reads customers. HEAD installs this checkout's packages/*.
import { cpSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	domainFilesCreate,
	domainNameRefusal,
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
import { checkoutExport, checkoutPackagesUse } from "./checkout.ts";

const fixture = join(import.meta.dirname, "second-domain");

const answers = {
	description: "Invoices for render-and-test.",
	name: "render-test",
	release: "",
};
// customer first: invoice-line's ports take the bridge built from customer's use cases.
const domains = [
	{
		definition: "Someone invoice lines are billed to.",
		kebab: "customer",
		plural: "customers",
	},
	{
		definition: "One charge on an invoice, which may name its customer.",
		kebab: "invoice-line",
		plural: "invoice-lines",
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
	await appRender(directory, previousFiles, answers);
	answersWrite(
		directory,
		{ ...answers, release: previous },
		domains.map((d) => ({
			definition: d.definition,
			term: glossaryTerm(d.kebab),
		})),
	);
	pnpmRun(directory, ["install"]);
	gitCommitAll(directory, `Create render-test from app@${previous}`);
	run("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], {
		cwd: directory,
	});

	console.log(`HEAD: template-upgrade to this checkout (${version})`);
	const { conflicts } = await templateUpgrade(directory, version, {
		fetch: (release) => (release === version ? files : previousFiles),
		finish: (tree) => templateFinish(tree, toolsDirectory),
	});
	if (conflicts.length > 0) {
		throw new Error(`template-upgrade conflicts: ${conflicts.join(", ")}`);
	}
	const upgraded = run("git", ["status", "--porcelain"], { cwd: directory });
	console.log(`template-upgrade changed:\n${upgraded || "(nothing)"}`);
	checkoutPackagesUse(directory);
	// The upgrade and the overrides change dependencies; CI's pnpm otherwise installs frozen.
	pnpmRun(directory, ["install", "--no-frozen-lockfile"]);

	for (const names of domains) {
		const refusal = domainNameRefusal(names, directory);
		if (refusal !== undefined) throw new Error(refusal);
		const created = domainFilesCreate(files, directory, names);
		filesWrite(directory, created);
		pnpmRun(directory, [
			"exec",
			"biome",
			"check",
			"--write",
			...created.map((f) => f.path),
		]);
	}
	if (process.env.RENDER_AND_TEST_STOP === "fixture") {
		// To change the fixture: edit this tree, then copy its new files to second-domain/files
		// and save `git diff` as second-domain/wiring.patch.
		gitCommitAll(directory, "Add customer and invoice-line");
		return;
	}
	cpSync(join(fixture, "files"), directory, { recursive: true });
	run("git", ["apply", "--whitespace=nowarn", join(fixture, "wiring.patch")], {
		cwd: directory,
	});
	pnpmRun(directory, ["exec", "biome", "check", "--write", "."]);
	pnpmRun(directory, ["codegen"]);
	pnpmRun(directory, ["check"]);
	pnpmRun(directory, ["test"]);
	gitCommitAll(directory, "Upgrade, add invoice-line and customer");
	console.log(readFileSync(join(directory, ".template.json"), "utf8"));
};

await main();
