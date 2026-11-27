// node scripts/clients-release.ts [--dry-run]: publishes clients/sdk and clients/cli to GitHub
// Packages, the npm registry of the Project's own repository, never to public npm (the SDK carries
// every environment's URL), as <scope>/<project>-sdk and <scope>/<project>-cli, both at one
// version, the SDK first. The scope is the CLIENTS_NPM_SCOPE variable, the repository's owner; .github/workflows/clients-release.yml runs this on every push to
// main (docs/agents/clients.md). The major is the API's (openapi.json `info.version`). Against the
// newest version published in that major, a change to what the SDK can call (openapi.json, sdk.ts,
// the environments) publishes the next minor, any other change (hand-written code, a dependency) the next patch, and
// no change publishes nothing. With none published yet the version is <major>.0.0. --dry-run is
// passed on to npm publish.
import {
	cpSync,
	existsSync,
	mkdtempDisposableSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { argsParse } from "./args.ts";
import {
	clients,
	clientsFilesRead,
	clientsManifestPublish,
	clientsVersionNext,
	jsonImportsTyped,
	manifestRead,
	unscoped,
} from "./clients-release-files.ts";
import {
	npm,
	registryWait,
	tarballUnpack,
	versionLatest,
} from "./clients-release-npm.ts";
import { processRun } from "./process-run.ts";

export const clientsRelease = ({
	directory,
	dryRun,
}: {
	directory: string;
	dryRun: boolean;
}): void => {
	const scopeName = process.env["CLIENTS_NPM_SCOPE"]?.replace(/^@/, "");
	if (!scopeName) throw new Error("Set CLIENTS_NPM_SCOPE to the npm scope.");
	const scope = `@${scopeName}`;
	const source = join(directory, "clients");
	const document = JSON.parse(
		readFileSync(join(source, "sdk/openapi.json"), "utf8"),
	) as { info: { version: string } };
	const major = Number.parseInt(document.info.version, 10);
	if (Number.isNaN(major))
		throw new Error("openapi.json info.version is no major");
	const present = clients.filter((c) =>
		existsSync(join(source, c, "package.json")),
	);
	const names = present.map((c) => manifestRead(join(source, c)).name);
	const sdk = unscoped(manifestRead(join(source, "sdk")).name);
	using work = mkdtempDisposableSync(join(tmpdir(), "clients-release-"));
	const latest = versionLatest(`${scope}/${sdk}`, major);
	for (const [k, client] of present.entries()) {
		if (latest !== undefined) {
			tarballUnpack(
				`${scope}/${names[k]}@${latest}`,
				join(work.path, "published", client),
			);
		}
	}
	const version = clientsVersionNext({
		current: clientsFilesRead(source),
		major,
		published:
			latest === undefined
				? null
				: {
						files: clientsFilesRead(join(work.path, "published")),
						version: latest,
					},
	});
	if (version === undefined) {
		console.log(`${scope}/${sdk}@${latest} is current: nothing to publish.`);
		return;
	}
	for (const [k, client] of present.entries()) {
		const name = `${scope}/${names[k]}`;
		const stage = join(work.path, "stage", client);
		cpSync(join(source, client), stage, {
			filter: (path) => !["dist", "node_modules"].includes(basename(path)),
			recursive: true,
		});
		// sdk-fetch.ts imports ../environments.json, which is the package root from dist/.
		if (client === "sdk")
			cpSync(
				join(source, "environments.json"),
				join(stage, "environments.json"),
			);
		const manifest = clientsManifestPublish({
			client,
			manifest: manifestRead(stage),
			scope,
			sdk,
			version,
		});
		writeFileSync(
			join(stage, "package.json"),
			`${JSON.stringify(manifest, null, "\t")}\n`,
		);
		// Type-strip each file to dist/, with declarations. Types are checked by pnpm check, and
		// --noResolve keeps the SDK's sources out of the CLI's build.
		const entries = readdirSync(stage).filter((f) => f.endsWith(".ts"));
		processRun({
			command: "pnpm",
			args: [
				"exec",
				"tsc",
				...entries.map((f) => join(stage, f)),
				"--outDir",
				join(stage, "dist"),
				..."--declaration --ignoreConfig --noCheck --noResolve --module nodenext --target es2024 --rewriteRelativeImportExtensions".split(
					" ",
				),
				"--types",
				"",
			],
			options: { cwd: directory, inherit: true },
		});
		// tsc drops a JSON import's `with { type: "json" }` from declarations, which nodenext needs.
		for (const file of readdirSync(join(stage, "dist"))) {
			const path = join(stage, "dist", file);
			if (file.endsWith(".d.ts"))
				writeFileSync(path, jsonImportsTyped(readFileSync(path, "utf8")));
		}
		console.log(`Publishing ${name}@${version}`);
		const publish = npm(["publish", ...(dryRun ? ["--dry-run"] : [])], stage);
		process.stdout.write(publish.stdout);
		process.stderr.write(publish.stderr);
		if (publish.status !== 0) {
			throw new Error(`npm publish ${name} failed.`);
		}
	}
	if (!dryRun) registryWait(names.map((n) => `${scope}/${n}@${version}`));
};

const usage = `Usage: node scripts/clients-release.ts [--dry-run]

Publishes clients/sdk and clients/cli to GitHub Packages when they changed.

  --dry-run   pass --dry-run on to npm publish
  -h, --help  this help`;

if (import.meta.main) {
	const parsed = argsParse({
		options: { "dry-run": { type: "boolean" } },
		usage,
	});
	if (parsed !== undefined) {
		try {
			clientsRelease({
				directory: process.cwd(),
				dryRun: parsed.values["dry-run"] === true,
			});
		} catch (error) {
			console.error(error instanceof Error ? error.message : error);
			process.exitCode = 1;
		}
	}
}
