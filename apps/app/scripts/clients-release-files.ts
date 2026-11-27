// What clients-release reads of clients/ and compares: the files each package publishes, the
// version to publish next, and the manifest npm gets.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// A package's path ("sdk/sdk.ts") to the text that decides its version.
export type Files = Readonly<Record<string, string>>;
export type Manifest = {
	bin?: Record<string, string>;
	dependencies?: Record<string, string>;
	exports?: Record<string, string>;
	name: string;
	[field: string]: unknown;
};

// The order they publish in: the CLI depends on the SDK.
export const clients = ["sdk", "cli"] as const;
const callable = new Set([
	"sdk/environments.json",
	"sdk/openapi.json",
	"sdk/sdk.ts",
]);

export const manifestRead = (folder: string): Manifest =>
	JSON.parse(readFileSync(join(folder, "package.json"), "utf8")) as Manifest;

export const unscoped = (name: string): string => name.replace(/^@[^/]+\//, "");

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
	return changed.some((path) => callable.has(path))
		? `${major}.${minor + 1}.0`
		: `${major}.${minor}.${patch + 1}`;
};

export const jsonImportsTyped = (declarations: string): string =>
	declarations.replaceAll(
		/^(import .* from "[^"]+\.json");$/gm,
		'$1 with { type: "json" };',
	);

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

// The manifest npm gets: scoped and versioned, pointing at the built JavaScript, with the
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
	const repository = process.env["GITHUB_REPOSITORY"];
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
