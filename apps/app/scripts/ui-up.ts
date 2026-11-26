// pnpm ui-up [--check] [--wait <seconds>]: boots the built app on memory adapters, on free ports.
// Without --check it prints the URL and keeps running until Ctrl-C, so a person or ui-shot can use
// it; with --check it stops once the sign-in page answers 200 and prints how long that took (the
// fast spin-up check). Run `pnpm build` first.
import { once } from "node:events";
import { argsFail, argsParse } from "./args.ts";
import { uiServerStart } from "./ui-server.ts";

const usage = `Usage: pnpm ui-up [--check] [--wait <seconds>]

Boots the production build (pnpm build first) on memory adapters, with no Docker, on ports the
kernel picks, so one runs per worktree at once. Prints its URL. Ctrl-C stops it.

  --check           stop once the sign-in page answers 200; exit 1 when it does not in time
  --wait <seconds>  how long to wait for that answer (default 30)
  -h, --help        this help`;

// The exit code, or undefined when argsParse has already said what it needed to.
const main = async (): Promise<number | undefined> => {
	const parsed = argsParse({
		options: {
			check: { type: "boolean" },
			wait: { default: "30", type: "string" },
		},
		usage,
	});
	if (parsed === undefined) return undefined;
	const waitSeconds = Number(parsed.values.wait);
	if (!Number.isFinite(waitSeconds) || waitSeconds <= 0) {
		argsFail(
			"ui-up",
			`--wait takes a number of seconds, got ${parsed.values.wait}`,
		);
		return 1;
	}
	const started = performance.now();
	await using server = await uiServerStart({ timeoutMs: waitSeconds * 1000 });
	const seconds = ((performance.now() - started) / 1000).toFixed(1);
	console.log(`ui-up: ${server.url}/ answered 200 in ${seconds} s`);
	if (parsed.values.check) return 0;
	console.log("ui-up: running, Ctrl-C stops it");
	await Promise.race([once(process, "SIGINT"), once(process, "SIGTERM")]);
	return 0;
};

if (import.meta.main) {
	try {
		process.exitCode = (await main()) ?? process.exitCode;
	} catch (error) {
		argsFail("ui-up", error instanceof Error ? error.message : String(error));
	}
}
