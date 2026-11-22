// Checks that a release landed: the Template's `app@<version>` and `v<major>` tags exist on origin, and
// every Package's current version is on npmjs with a provenance attestation. The registry can lag a few
// minutes behind a publish, so a missing version is retried before it counts as missing.
// Usage: node scripts/release-verify.ts [--retries <n>] [--wait <seconds>]
// Exit code 0: everything is there, 1: something is missing.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

export type ReleaseVerifyPackage = { name: string; version: string };

export const releaseVerifyTagsMissing = ({
	lsRemote,
	version,
}: {
	lsRemote: string;
	version: string;
}): string[] => {
	const tags = new Set(
		lsRemote
			.split("\n")
			.map((line) => line.split("\t")[1]?.replace(/^refs\/tags\//, ""))
			.filter((tag): tag is string => tag !== undefined),
	);
	return [`app@${version}`, `v${version.split(".")[0]}`].filter(
		(tag) => !tags.has(tag),
	);
};

// What the registry says about one version: absent, published, or published with provenance.
export const releaseVerifyEntryRead = (
	entry: unknown,
): "absent" | "provenance" | "unattested" => {
	if (entry === undefined || entry === null) return "absent";
	const attestations = (
		entry as { dist?: { attestations?: { provenance?: unknown } } }
	).dist?.attestations;
	return attestations?.provenance ? "provenance" : "unattested";
};

export const releaseVerifyPackagesRead = (
	root: string,
): ReleaseVerifyPackage[] =>
	readdirSync(join(root, "packages")).flatMap((directory) => {
		try {
			const manifest = JSON.parse(
				readFileSync(join(root, "packages", directory, "package.json"), "utf8"),
			) as { name: string; private?: boolean; version: string };
			return manifest.private
				? []
				: [{ name: manifest.name, version: manifest.version }];
		} catch {
			return [];
		}
	});

export const releaseVerifyPackageCheck = async ({
	entryFetch,
	retries,
	sleep,
	wait,
	...pkg
}: ReleaseVerifyPackage & {
	entryFetch: (pkg: ReleaseVerifyPackage) => Promise<unknown>;
	retries: number;
	sleep: (seconds: number) => Promise<void>;
	wait: number;
}): Promise<string | undefined> => {
	for (let attempt = 0; ; attempt++) {
		const state = releaseVerifyEntryRead(await entryFetch(pkg));
		if (state === "provenance") return undefined;
		if (attempt >= retries) {
			return `${pkg.name}@${pkg.version}: ${state === "absent" ? "not on npmjs" : "on npmjs without a provenance attestation"}`;
		}
		await sleep(wait);
	}
};

if (import.meta.main) {
	const { values } = parseArgs({
		options: {
			retries: { default: "5", type: "string" },
			wait: { default: "60", type: "string" },
		},
	});
	const root = process.cwd();
	const app = JSON.parse(
		readFileSync(join(root, "apps/app/package.json"), "utf8"),
	) as { version: string };
	const problems: string[] = releaseVerifyTagsMissing({
		lsRemote: execFileSync(
			"git",
			["ls-remote", "--tags", "origin", "refs/tags/app@*", "refs/tags/v*"],
			{ encoding: "utf8" },
		),
		version: app.version,
	}).map((tag) => `tag ${tag} is not on origin`);
	const results = await Promise.all(
		releaseVerifyPackagesRead(root).map((pkg) =>
			releaseVerifyPackageCheck({
				...pkg,
				entryFetch: async ({ name, version }) => {
					const response = await fetch(
						`https://registry.npmjs.org/${name}/${version}`,
					);
					return response.ok ? response.json() : undefined;
				},
				retries: Number(values.retries),
				sleep: (seconds) =>
					new Promise((done) => setTimeout(done, seconds * 1000)),
				wait: Number(values.wait),
			}),
		),
	);
	problems.push(...results.filter((r): r is string => r !== undefined));
	for (const problem of problems) console.error(problem);
	console.log(
		problems.length === 0 ? "release verified" : `${problems.length} missing`,
	);
	process.exitCode = problems.length === 0 ? 0 : 1;
}
