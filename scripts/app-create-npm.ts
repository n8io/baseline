// Waits for npm to serve the @n8io/baseline-* versions a rendered Project pins.
import { setTimeout } from "node:timers/promises";

type PackageVersion = { name: string; version: string };

// The @n8io/baseline-* versions a rendered package.json pins: ^2.1.0 needs 2.1.0 on npm.
export const baselinePackagesPinned = (manifest: string): PackageVersion[] =>
	Object.entries(
		(JSON.parse(manifest) as { dependencies?: Record<string, string> })
			.dependencies ?? {},
	)
		.filter(([name]) => name.startsWith("@n8io/baseline-"))
		.map(([name, range]) => ({ name, version: range.replace(/^[\^~]/, "") }));

// npm serves a fresh release minutes after it publishes. Polls each version until the registry
// answers, with one status line, and fails after `timeoutMs`.
export const npmVersionsWait = async ({
	intervalMs,
	log,
	packages,
	registry,
	timeoutMs,
}: {
	intervalMs?: number | null;
	log?: ((line: string) => void) | null;
	packages: PackageVersion[];
	registry?: string | null;
	timeoutMs?: number | null;
}): Promise<void> => {
	const interval = intervalMs ?? 15_000;
	const timeout = timeoutMs ?? 15 * 60_000;
	const deadline = Date.now() + timeout;
	let missing = packages;
	let waiting = false;
	for (;;) {
		const served = await Promise.all(
			missing.map(async ({ name, version }) => {
				try {
					const response = await fetch(
						`${registry ?? "https://registry.npmjs.org"}/${name}/${version}`,
					);
					await response.body?.cancel();
					return response.ok;
				} catch {
					return false;
				}
			}),
		);
		missing = missing.filter((_, index) => !served[index]);
		if (missing.length === 0) return;
		const names = missing.map((p) => `${p.name}@${p.version}`).join(", ");
		if (Date.now() + interval > deadline) {
			throw new Error(
				`npm still does not serve ${names} after ${timeout / 60_000} min`,
			);
		}
		if (!waiting) {
			(log ?? console.log)(
				`Waiting for npm to serve ${names}: a fresh release takes a few minutes. Checking every ${interval / 1000} s for up to ${timeout / 60_000} min.`,
			);
			waiting = true;
		}
		await setTimeout(interval);
	}
};
