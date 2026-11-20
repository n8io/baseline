// node scripts/clients-release.ts [--dry-run]: publishes clients/sdk and clients/cli to GitHub
// Packages, the npm registry of the Project's own repository, never to public npm (the SDK carries
// every environment's URL), as <scope>/<project>-sdk and <scope>/<project>-cli, both at one
// version, the SDK first. The scope is the CLIENTS_NPM_SCOPE variable, the repository's owner; .github/workflows/clients-release.yml runs this on every push to
// main (docs/agents/clients.md). The major is the API's (openapi.json `info.version`). Against the
// newest version published in that major, a change to what the SDK can call (openapi.json, sdk.ts,
// the environments) publishes the next minor, any other change (hand-written code, a dependency) the next patch, and
// no change publishes nothing. With none published yet the version is <major>.0.0. --dry-run is
// passed on to npm publish.
import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempDisposableSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

// A package's path ("sdk/sdk.ts") to the text that decides its version.
type Files = Readonly<Record<string, string>>;
type Manifest = {
	bin?: Record<string, string>;
	dependencies?: Record<string, string>;
	exports?: Record<string, string>;
	name: string;
	[field: string]: unknown;
};

// The order they publish in: the CLI depends on the SDK.
const clients = ["sdk", "cli"] as const;
const generated = new Set([
	"sdk/environments.json",
	"sdk/openapi.json",
	"sdk/sdk.ts",
]);
const registry = "https://npm.pkg.github.com";

const manifestRead = (folder: string): Manifest =>
	JSON.parse(readFileSync(join(folder, "package.json"), "utf8")) as Manifest;

const unscoped = (name: string): string => name.replace(/^@[^/]+\//, "");

// The source files of each package in `directory` (clients/ or an unpacked release), and the
// dependencies each installs. The CLI's dependency on the SDK is left out: it is the version itself.
// clients/environments.json counts as the SDK's: it is published inside it.
// Every file counts, so a file npm leaves out of a tarball (.npmrc, package-lock.json) must not
// sit in clients/: it would differ on every run and publish a patch each time.
export const clientsFilesRead = (directory: string): Files => {
	const files: Record<string, string> = {};
	for (const client of clients) {
		const folder = join(directory, client);
		if (!existsSync(join(folder, "package.json"))) continue;
		for (const path of readdirSync(folder, { recursive: true }) as string[]) {
			if (/^(dist|node_modules)(\/|$)/.test(path) || path === "package.json")
				continue;
			const file = join(folder, path);
			if (statSync(file).isFile())
				files[`${client}/${path}`] = readFileSync(file, "utf8");
		}
		const sdk = existsSync(join(directory, "sdk/package.json"))
			? unscoped(manifestRead(join(directory, "sdk")).name)
			: "";
		const { [sdk]: _, ...dependencies } =
			manifestRead(folder).dependencies ?? {};
		files[`${client}/package.json`] = JSON.stringify(dependencies);
	}
	const environments = join(directory, "environments.json");
	if (existsSync(environments))
		files["sdk/environments.json"] = readFileSync(environments, "utf8");
	return files;
};

// The version to publish, or undefined when the published one is current.
export const clientsVersionNext = ({
	current,
	major,
	published,
}: {
	current: Files;
	major: number;
	published?: { files: Files; version: string } | null;
}): string | undefined => {
	if (published == null) return `${major}.0.0`;
	const paths = new Set([
		...Object.keys(current),
		...Object.keys(published.files),
	]);
	const changed = [...paths].filter((p) => current[p] !== published.files[p]);
	if (changed.length === 0) return undefined;
	const [, minor = 0, patch = 0] = published.version.split(".").map(Number);
	return changed.some((path) => generated.has(path))
		? `${major}.${minor + 1}.0`
		: `${major}.${minor}.${patch + 1}`;
};

export const jsonImportsTyped = (declarations: string): string =>
	declarations.replaceAll(
		/^(import .* from "[^"]+\.json");$/gm,
		'$1 with { type: "json" };',
	);

const npm = (args: string[], cwd?: string) =>
	spawnSync("npm", [...args, "--registry", registry], {
		cwd,
		encoding: "utf8",
	});

const npmMissingIs = ({ stderr, stdout }: { stderr: string; stdout: string }) =>
	/E404|ETARGET/.test(`${stdout}${stderr}`);

// The newest version of `name` in `major`, or undefined when npm has none.
const versionLatest = (name: string, major: number): string | undefined => {
	const view = npm(["view", `${name}@^${major}`, "version", "--json"]);
	if (view.status !== 0) {
		if (npmMissingIs(view)) return undefined;
		throw new Error(`npm view ${name} failed:\n${view.stderr}`);
	}
	const versions = [
		JSON.parse(view.stdout || "[]") as string | string[],
	].flat();
	return versions
		.sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
		.at(-1);
};

// Waits, up to 3 minutes, until npm shows each new version: npm lists one about a minute after
// the publish, and the next run (runs go one at a time) would otherwise pick the same version.
const registryWait = (specs: string[]): void => {
	for (const spec of specs) {
		for (
			let tries = 0;
			npm(["view", spec, "version"]).stdout.trim() === "";
			tries++
		) {
			if (tries === 18)
				throw new Error(`npm does not show ${spec} after 3 minutes`);
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10_000);
		}
	}
};

const run = ([command = "", ...args]: string[], cwd?: string): void => {
	const result = spawnSync(command, args, { cwd, stdio: "inherit" });
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} failed in ${cwd ?? "."}`);
	}
};

// Unpacks the published `spec` into `folder`; leaves no folder when npm has no such version.
const tarballUnpack = (spec: string, folder: string): void => {
	const pack = npm(["pack", spec, "--json"], tmpdir());
	if (pack.status !== 0) {
		if (npmMissingIs(pack)) return;
		throw new Error(`npm pack ${spec} failed:\n${pack.stderr}`);
	}
	const [{ filename } = { filename: "" }] = JSON.parse(pack.stdout) as {
		filename: string;
	}[];
	const tarball = join(tmpdir(), filename);
	mkdirSync(folder, { recursive: true });
	run(["tar", "-xzf", tarball, "-C", folder, "--strip-components=1"]);
	rmSync(tarball);
};

// npm wants a bin path without the leading ./ that exports need.
const distJs = (path: string): string =>
	path.replace(/^(\.\/)?(.+)\.ts$/, "dist/$2.js");

const recordMap = <T>(
	record: Record<string, string>,
	map: (value: string, key: string) => T,
): Record<string, T> =>
	Object.fromEntries(
		Object.entries(record).map(([key, value]) => [key, map(value, key)]),
	);

// The manifest npm gets: scoped, versioned and public, pointing at the built JavaScript, with the
// SDK dependency as an npm alias of the SDK published beside it.
export const clientsManifestPublish = ({
	client,
	manifest,
	scope,
	sdk,
	version,
}: {
	client: string;
	manifest: Manifest;
	scope: string;
	sdk: string;
	version: string;
}): Record<string, unknown> => {
	const { private: _, scripts: __, ...rest } = manifest;
	const repository = process.env.GITHUB_REPOSITORY;
	return {
		...rest,
		name: `${scope}/${manifest.name}`,
		version,
		...(manifest.bin && { bin: recordMap(manifest.bin, distJs) }),
		...(manifest.exports && {
			exports: recordMap(manifest.exports, (path) =>
				path.endsWith(".ts")
					? {
							// Conditions are read in order: types before default.
							types: `./${distJs(path).replace(/js$/, "d.ts")}`,
							default: `./${distJs(path)}`,
						}
					: path,
			),
		}),
		dependencies: recordMap(manifest.dependencies ?? {}, (range, name) =>
			name === sdk ? `npm:${scope}/${sdk}@${version}` : range,
		),
		// GitHub Packages links the package to the repository it names, which grants its access.
		...(repository && {
			repository: {
				directory: `clients/${client}`,
				type: "git",
				url: `git+https://github.com/${repository}.git`,
			},
		}),
	};
};

export const clientsRelease = ({
	directory,
	dryRun,
}: {
	directory: string;
	dryRun: boolean;
}): void => {
	const scopeName = process.env.CLIENTS_NPM_SCOPE?.replace(/^@/, "");
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
		run(
			[
				"pnpm",
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
			directory,
		);
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

if (import.meta.main) {
	try {
		clientsRelease({
			directory: process.cwd(),
			dryRun: process.argv.includes("--dry-run"),
		});
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}
