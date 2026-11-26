// Boots the built app for a browser: the production build on memory adapters, one process, no Docker,
// on ports the kernel hands out. Several of these run at once (one per worktree, or one per test
// file) because nothing is shared: each has its own ports and its own memory adapters. Not a
// command: ui-up, ui-shot and the e2e tests import it. `pnpm build` first.
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const serverEntry = "build/server/index.js";
const bootAttemptsMax = 3;

/** A Server on memory adapters, ready to answer. Disposing it stops the process. */
export type UiServer = AsyncDisposable & { url: string };

// Ports the kernel hands out. All are held open together, so they differ, and freed at once; the
// Server binds them a moment later. Another instance may take one in between: uiServerStart retries.
export const uiServerPortsFree = async (count: number): Promise<number[]> => {
	const probes = await Promise.all(
		Array.from({ length: count }, async () => {
			const probe = createServer().listen(0, "127.0.0.1");
			await once(probe, "listening");
			return probe;
		}),
	);
	const ports = probes.map((probe) => {
		const address = probe.address();
		if (address === null || typeof address === "string") {
			throw new Error("no port");
		}
		return address.port;
	});
	await Promise.all(
		probes.map(async (probe) => {
			probe.close();
			await once(probe, "close");
		}),
	);
	return ports;
};

export const uiServerPortFree = async (): Promise<number> => {
	const [port = 0] = await uiServerPortsFree(1);
	return port;
};

const stop = async (child: ChildProcess): Promise<void> => {
	if (child.exitCode !== null || child.signalCode !== null) return;
	const exited = once(child, "close");
	child.kill("SIGTERM");
	const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
	try {
		await exited;
	} finally {
		clearTimeout(timer);
	}
};

type Boot = { clash: string } | { server: UiServer };

// One boot on two fresh ports. A port another process took in the meantime is a clash, not an error.
const uiServerBoot = async (timeoutMs: number): Promise<Boot> => {
	const [port = 0, healthPort = 0] = await uiServerPortsFree(2);
	const child = spawn(
		process.execPath,
		["--import", resolve("src/preload.ts"), serverEntry],
		{
			env: {
				...process.env,
				// The Vitest worker's serialized varlock env would win over every override below.
				__VARLOCK_ENV: undefined,
				APP_ENV: "test",
				CACHE_URL: "memory://",
				DATABASE_URL: "memory://",
				HEALTH_PORT: String(healthPort),
				LOG_LEVEL: "fatal",
				NODE_ENV: "production",
				OTEL_LOGS_EXPORTER: "none",
				OTEL_METRICS_EXPORTER: "none",
				OTEL_TRACES_EXPORTER: "none",
				PORT: String(port),
			},
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	let output = "";
	for (const stream of [child.stdout, child.stderr]) {
		stream?.on("data", (chunk) => {
			output += String(chunk);
		});
	}
	const url = `http://127.0.0.1:${port}`;
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) {
			if (output.includes("EADDRINUSE")) return { clash: output };
			throw new Error(
				`the Server exited ${child.exitCode} on boot:\n${output}`,
			);
		}
		const status = await fetch(`${url}/auth/sign-in`).then(
			(res) => res.status,
			() => undefined,
		);
		if (status === 200) {
			return { server: { url, [Symbol.asyncDispose]: () => stop(child) } };
		}
		await delay(50);
	}
	await stop(child);
	throw new Error(
		`the Server did not answer 200 in ${timeoutMs / 1000} s:\n${output}`,
	);
};

/** Boots the production build and resolves once the sign-in page answers 200. */
export const uiServerStart = async (
	options?: { attempt?: number | null; timeoutMs?: number | null } | null,
): Promise<UiServer> => {
	const attempt = options?.attempt ?? 1;
	const booted = await uiServerBoot(options?.timeoutMs ?? 30_000);
	if ("server" in booted) return booted.server;
	if (attempt >= bootAttemptsMax) {
		throw new Error(
			`a port was taken on each of ${bootAttemptsMax} boots:\n${booted.clash}`,
		);
	}
	return uiServerStart({ ...options, attempt: attempt + 1 });
};
