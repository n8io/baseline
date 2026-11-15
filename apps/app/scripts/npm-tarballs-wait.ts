// Shared by app-create, template-upgrade and render-and-test. Native TS, no dependencies.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

// Waits until npm serves the tarball of every @n8io/baseline-* package the project's lockfile
// resolved. On a release day the newest is seconds old: npm lists a version before its tarball
// answers, and the install fails with ERR_PNPM_TARBALL_HTTP_STATUS 404 (run 43596056438, 30 s to
// 2.5 min after the publish). pnpm asks only twice, at once, on a 404 whatever fetchRetries says;
// fetchRetries covers 5xx and network errors, so any answer but 404 is left to the install. Five
// minutes of 404 is a registry delay, reported before a CI job's 10 minute limit.
export const npmTarballsWait = async ({
	directory,
	intervalMs,
	log,
	registry,
	timeoutMs,
}: {
	directory: string;
	intervalMs?: number | null;
	log?: ((line: string) => void) | null;
	registry?: string | null;
	timeoutMs?: number | null;
}): Promise<void> => {
	const interval = intervalMs ?? 15_000;
	const timeout = timeoutMs ?? 5 * 60_000;
	const lockfile = readFileSync(join(directory, "pnpm-lock.yaml"), "utf8");
	const urls = [
		...lockfile.matchAll(/^ {2}'?@n8io\/(baseline-[^@']+)@([^:'(]+)'?:$/gm),
	].map(
		([, name, version]) =>
			`${registry ?? "https://registry.npmjs.org"}/@n8io/${name}/-/${name}-${version}.tgz`,
	);
	const deadline = Date.now() + timeout;
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
				throw new Error(
					`npm still answers 404 after ${timeout / 60_000} min for ${url}. This is a registry delay after a fresh publish, not a broken Project. Try again in a few minutes.`,
				);
			}
			(log ?? console.log)(`waiting for npm to serve ${url}`);
			await setTimeout(interval);
		}
	}
};
