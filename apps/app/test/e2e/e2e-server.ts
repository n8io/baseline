import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const serverEntry = "build/server/index.js";

/** A Server on memory adapters: no Docker, one process. */
export type E2eServer = AsyncDisposable & { url: string };

// A port the kernel hands out and frees at once; the Server binds it a moment later.
const portFree = async (): Promise<number> => {
	const probe = createServer().listen(0, "127.0.0.1");
	await once(probe, "listening");
	const address = probe.address();
	if (address === null || typeof address === "string") {
		throw new Error("no port");
	}
	probe.close();
	await once(probe, "close");
	return address.port;
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

/** Boots the production build (`pnpm build` first) and resolves once the sign-in page answers 200. */
export const e2eServerStart = async (): Promise<E2eServer> => {
	const [port, healthPort] = [await portFree(), await portFree()];
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
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) {
			throw new Error(
				`the Server exited ${child.exitCode} on boot:\n${output}`,
			);
		}
		const status = await fetch(`${url}/auth/sign-in`).then(
			(res) => res.status,
			() => undefined,
		);
		if (status === 200) {
			return { url, [Symbol.asyncDispose]: () => stop(child) };
		}
		await delay(50);
	}
	await stop(child);
	throw new Error(`the Server did not answer 200 in 30 s:\n${output}`);
};
