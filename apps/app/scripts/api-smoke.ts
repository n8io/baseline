// pnpm api-smoke [--url <origin>] [--wait <seconds>]: asks a served app's memory issuer for the dev
// client's token, then calls the OpenAPI document and every route that needs no input with it.
// Prints one line per call and a summary; exits 1 when any call fails. It is the pattern for a
// Project's own scripts: docs/agents/scripts.md.
import { parseArgs } from "node:util";
import { authnMemoryTokenFetch } from "@n8io/baseline-authn";
import { telemetryShutdown } from "@n8io/baseline-telemetry";

const usage = `Usage: pnpm api-smoke [--url <origin>] [--wait <seconds>]

Calls GET /api/v1/openapi.json and every other GET route of the API that takes no path
parameter, with the dev client's token, and exits 1 when any call does not answer 2xx.
The app must run with the memory issuer (AUTHN_ISSUER_URL=memory://).

  --url <origin>    the app's origin (default http://localhost:3000)
  --wait <seconds>  how long to wait for the app to answer (default 30)
  -h, --help        print this`;

type Operation = { parameters?: { required?: boolean }[] };

// The API's GET routes that need no input (no path parameter, no required parameter), from its
// OpenAPI document.
export const apiSmokeRoutesFind = (document: unknown): string[] => {
	const { paths = {} } = (document ?? {}) as {
		paths?: Record<string, { get?: Operation }>;
	};
	return Object.entries(paths)
		.filter(
			([path, { get }]) =>
				!path.includes("{") &&
				get !== undefined &&
				!get.parameters?.some((parameter) => parameter.required),
		)
		.map(([path]) => path)
		.sort();
};

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

// Polls the document until the app answers it or the deadline passes.
const documentWait = async (
	url: string,
	deadline: number,
): Promise<unknown> => {
	let last = "no answer";
	for (;;) {
		try {
			const res = await fetch(`${url}/api/v1/openapi.json`, {
				signal: AbortSignal.timeout(5_000),
			});
			if (res.ok) return await res.json();
			last = `status ${res.status}`;
			await res.body?.cancel();
		} catch (error) {
			// Not listening yet, or not an API.
			last = error instanceof Error ? error.message : String(error);
		}
		if (Date.now() >= deadline) {
			throw new Error(
				`${url}/api/v1/openapi.json did not answer in time (last: ${last})`,
			);
		}
		await sleep(500);
	}
};

const main = async (): Promise<number> => {
	const { values } = parseArgs({
		options: {
			help: { short: "h", type: "boolean" },
			url: { default: "http://localhost:3000", type: "string" },
			wait: { default: "30", type: "string" },
		},
		strict: true,
	});
	if (values.help) {
		console.log(usage);
		return 0;
	}
	const url = values.url.replace(/\/+$/, "");
	const waitSeconds = Number(values.wait);
	if (!Number.isFinite(waitSeconds) || waitSeconds < 0) {
		throw new Error(`--wait takes a number of seconds, got ${values.wait}`);
	}

	const document = await documentWait(url, Date.now() + waitSeconds * 1000);
	const { authorization } = await authnMemoryTokenFetch({
		clientId: "dev-client",
		url,
	});
	// The document's paths start at /api/v1.
	const calls = ["/api/v1/openapi.json", ...apiSmokeRoutesFind(document)];

	let failed = 0;
	for (const path of calls) {
		const started = Date.now();
		const res = await fetch(`${url}${path}`, {
			headers: { authorization },
			signal: AbortSignal.timeout(10_000),
		}).catch((error: unknown) => error as Error);
		const ok = res instanceof Response && res.ok;
		if (res instanceof Response) await res.body?.cancel();
		if (!ok) failed++;
		console.log(
			`${ok ? "ok  " : "FAIL"} GET ${path} ${res instanceof Response ? res.status : res.message} ${Date.now() - started}ms`,
		);
	}
	console.log(
		`api-smoke: ${calls.length - failed} of ${calls.length} calls ok`,
	);
	return failed === 0 ? 0 : 1;
};

if (import.meta.main) {
	try {
		process.exitCode = await main();
	} catch (error) {
		console.error(
			`api-smoke: ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exitCode = 1;
	} finally {
		// Last, so the spans of the calls above leave before the process does.
		await telemetryShutdown();
	}
}
