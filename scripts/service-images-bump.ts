// Re-resolves the digest of every service image the CI workflows pin (`image: name:tag@sha256:…`),
// so a CVE fix in a service image reaches CI on the weekly bump. Writes the workflows in place and
// prints the changed files; the workflow opens the pull request. Docker Hub official images only.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const serviceWorkflows = [
	".github/workflows/integration.yml",
	".github/workflows/app-ci.yml",
] as const;

export type ServiceImage = { digest: string; name: string; tag: string };

const pinnedImage = /image:\s*([a-z0-9.-]+):([\w.-]+)@sha256:([0-9a-f]{64})/g;

// Every pinned service image in one workflow's text.
export const serviceImagesRead = (text: string): ServiceImage[] =>
	[...text.matchAll(pinnedImage)].map((m) => ({
		digest: m[3] ?? "",
		name: m[1] ?? "",
		tag: m[2] ?? "",
	}));

// Rewrites each pinned digest that the registry now resolves differently. `resolved` maps
// `name:tag` to the current digest; an image it does not name keeps its pin.
export const serviceImagesRewrite = (
	text: string,
	resolved: Map<string, string>,
): string =>
	text.replace(pinnedImage, (whole: string) => {
		const [, name = "", tag = "", digest = ""] =
			new RegExp(pinnedImage.source).exec(whole) ?? [];
		const current = resolved.get(`${name}:${tag}`);
		if (current === undefined || current === `sha256:${digest}`) return whole;
		return whole.replace(`@sha256:${digest}`, `@sha256:${current.slice(7)}`);
	});

// The digest the registry serves for `name:tag` (`sha256:…`), read from the manifest's
// Docker-Content-Digest header. A Docker Hub official image lives under `library/`.
export const serviceDigestResolve = async ({
	name,
	tag,
}: {
	name: string;
	tag: string;
}): Promise<string> => {
	const repository = `library/${name}`;
	const tokenRes = await fetch(
		`https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repository}:pull`,
	);
	const { token } = (await tokenRes.json()) as { token: string };
	const manifest = await fetch(
		`https://registry-1.docker.io/v2/${repository}/manifests/${tag}`,
		{
			headers: {
				Accept: [
					"application/vnd.oci.image.index.v1+json",
					"application/vnd.docker.distribution.manifest.list.v2+json",
				].join(", "),
				Authorization: `Bearer ${token}`,
			},
			method: "HEAD",
		},
	);
	const digest = manifest.headers.get("docker-content-digest");
	if (
		!manifest.ok ||
		digest === null ||
		!/^sha256:[0-9a-f]{64}$/.test(digest)
	) {
		throw new Error(`no digest for ${name}:${tag} (HTTP ${manifest.status})`);
	}
	return digest;
};

const main = async (): Promise<void> => {
	const root = resolve(import.meta.dirname, "..");
	const images = new Map<string, ServiceImage>();
	for (const file of serviceWorkflows) {
		for (const image of serviceImagesRead(
			readFileSync(join(root, file), "utf8"),
		)) {
			images.set(`${image.name}:${image.tag}`, image);
		}
	}
	const resolved = new Map<string, string>();
	for (const [key, image] of images) {
		resolved.set(key, await serviceDigestResolve(image));
	}
	for (const file of serviceWorkflows) {
		const path = join(root, file);
		const before = readFileSync(path, "utf8");
		const after = serviceImagesRewrite(before, resolved);
		if (after !== before) {
			writeFileSync(path, after);
			console.log(`changed ${file}`);
		}
	}
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}
