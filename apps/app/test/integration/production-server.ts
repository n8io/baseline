import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import {
	type IncomingHttpHeaders,
	type IncomingMessage,
	type OutgoingHttpHeaders,
	request,
} from "node:http";
import { connect, createServer as netServerCreate } from "node:net";

// Every entry in the image starts with these, varlock first.
const preloadFlags = [
	"--import",
	"varlock/auto-load",
	"--import",
	"@n8io/baseline-telemetry/register",
	"--experimental-loader=@opentelemetry/instrumentation/hook.mjs",
];

const serverEntry = "build/server/index.js";

const freePort = async (): Promise<number> => {
	const server = netServerCreate().listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	server.close();
	if (address === null || typeof address === "string") {
		throw new Error("no free port");
	}
	return address.port;
};

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

// Polls `check` every 50 ms until it returns true, or throws `what` after `timeoutMs`.
export const productionServerWaitFor = async (
	what: string,
	check: () => Promise<boolean> | boolean,
	timeoutMs = 10_000,
): Promise<void> => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await check()) return;
		await sleep(50);
	}
	throw new Error(`timed out waiting for ${what}`);
};

export type AppProcess = {
	child: ChildProcess;
	/** Resolves with the exit code once the process has exited. */
	exited: Promise<number | null>;
	healthPort: number;
	stderr: () => string;
	stdout: () => string;
	/** Sends SIGTERM unless it has already exited, and resolves with the exit code. */
	stop: () => Promise<number | null>;
};

type AppProcessOptions = {
	cacheUrl: string;
	databaseUrl: string;
	/** Overrides, e.g. LOG_LEVEL or OTEL_* for the telemetry test. */
	env?: Record<string, string>;
};

const hasExited = (child: ChildProcess): boolean =>
	child.exitCode !== null || child.signalCode !== null;

// Spawns the entry with the image's preloads and env; does not wait for anything.
const appProcessSpawn = async (
	entry: string,
	{ cacheUrl, databaseUrl, env = {} }: AppProcessOptions,
	extraEnv: Record<string, string>,
): Promise<AppProcess> => {
	const healthPort = await freePort();
	const child = spawn(process.execPath, [...preloadFlags, entry], {
		env: {
			...process.env,
			// The Vitest worker's serialized varlock env would win over every override below.
			__VARLOCK_ENV: undefined,
			APP_ENV: "test",
			CACHE_URL: cacheUrl,
			DATABASE_URL: databaseUrl,
			HEALTH_PORT: String(healthPort),
			LOG_LEVEL: "silent",
			// react-router-hono-server listens on PORT only outside development.
			NODE_ENV: "production",
			OTEL_LOGS_EXPORTER: "none",
			OTEL_METRICS_EXPORTER: "none",
			OTEL_TRACES_EXPORTER: "none",
			...extraEnv,
			...env,
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	child.stdout?.on("data", (chunk) => {
		stdout += String(chunk);
	});
	child.stderr?.on("data", (chunk) => {
		stderr += String(chunk);
	});
	// "close" waits for stdout and stderr to drain as well; "exit" can fire before their last chunks.
	const exited = once(child, "close").then(([code]) => code as number | null);
	return {
		child,
		exited,
		healthPort,
		stderr: () => stderr,
		stdout: () => stdout,
		stop: async () => {
			if (!hasExited(child)) {
				child.kill("SIGTERM");
			}
			// A child that hangs past the 25 s shutdown deadline is killed.
			const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
			try {
				return await exited;
			} finally {
				clearTimeout(timer);
			}
		},
	};
};

const appProcessStart = async (
	entry: string,
	options: AppProcessOptions,
	extraEnv: Record<string, string>,
): Promise<AppProcess> => {
	const app = await appProcessSpawn(entry, options, extraEnv);
	try {
		await productionServerWaitFor(
			`${entry} /readyz 200`,
			async () => {
				if (hasExited(app.child)) {
					throw new Error(`${entry} exited early: ${app.stderr()}`);
				}
				return (await httpStatus(app.healthPort, "/readyz")) === 200;
			},
			20_000,
		);
	} catch (error) {
		await app.stop();
		throw error;
	}
	return app;
};

export const httpStatus = async (
	port: number,
	path: string,
): Promise<number | undefined> => {
	const res = await fetch(`http://127.0.0.1:${port}${path}`, {
		signal: AbortSignal.timeout(2_000),
	}).catch(() => undefined);
	await res?.body?.cancel();
	return res?.status;
};

/** Waits for /readyz 503 (shutdown started); throws if the process exits first. */
export const shutdownStarted = (app: AppProcess): Promise<void> =>
	productionServerWaitFor("/readyz 503", async () => {
		if (hasExited(app.child)) {
			throw new Error("exited before /readyz answered 503");
		}
		return (await httpStatus(app.healthPort, "/readyz")) === 503;
	});

// Resolves with the error code of a new TCP connection, or "connected".
export const productionServerConnectResult = (port: number): Promise<string> =>
	new Promise((resolve) => {
		const socket = connect(port, "127.0.0.1");
		socket.once("connect", () => {
			socket.destroy();
			resolve("connected");
		});
		socket.once("error", (error: NodeJS.ErrnoException) =>
			resolve(error.code ?? "error"),
		);
	});

type SlowRequest = {
	/** Drops the request; call it before stopping the server, which would wait for it. */
	abort: () => void;
	/** Sends the rest of the body and resolves with the response. */
	finish: () => Promise<{
		headers: IncomingHttpHeaders;
		status: number | undefined;
		text: string;
	}>;
};

/**
 * Starts a POST whose body arrives in two parts. Expect: 100-continue makes the server say when
 * it has the request, so this resolves once the request is in flight, with five bytes sent.
 */
export const slowRequestStart = async (
	port: number,
	{
		body,
		headers,
		path,
	}: { body: string; headers: OutgoingHttpHeaders; path: string },
): Promise<SlowRequest> => {
	const slow = request({
		headers: {
			...headers,
			"content-length": Buffer.byteLength(body),
			expect: "100-continue",
		},
		host: "127.0.0.1",
		method: "POST",
		path,
		port,
	});
	const responded = once(slow, "response") as Promise<[IncomingMessage]>;
	responded.catch(() => undefined);
	await once(slow, "continue");
	slow.write(body.slice(0, 5));
	return {
		abort: () => slow.destroy(),
		finish: async () => {
			slow.end(body.slice(5));
			const [res] = await responded;
			let text = "";
			for await (const chunk of res) text += chunk;
			return { headers: res.headers, status: res.statusCode, text };
		},
	};
};

export type ProductionServer = AppProcess & { port: number; url: string };

/**
 * Boots the production build (`react-router build` output) the way the image runs it: the three
 * preload flags, NODE_ENV=production, APP_ENV=test, real Postgres and Redis, the memory issuer.
 * Resolves once /readyz answers 200 and the server answers on PORT.
 */
export const productionServerStart = async (
	options: AppProcessOptions,
): Promise<ProductionServer> => {
	if (!existsSync(serverEntry)) {
		throw new Error(`${serverEntry} is missing: run react-router build first`);
	}
	const port = await freePort();
	const app = await appProcessStart(serverEntry, options, {
		PORT: String(port),
	});
	try {
		await productionServerWaitFor(
			"the server on PORT",
			async () => (await httpStatus(port, "/auth/sign-in")) === 200,
			20_000,
		);
	} catch (error) {
		await app.stop();
		throw error;
	}
	return { ...app, port, url: `http://127.0.0.1:${port}` };
};

/** Boots `src/worker.ts` as native TS with the same preloads; resolves once /readyz is 200. */
export const workerStart = (options: AppProcessOptions): Promise<AppProcess> =>
	appProcessStart("src/worker.ts", options, {});

/** Starts the worker without waiting for readiness, for boots that are meant to fail. */
export const workerSpawn = (options: AppProcessOptions): Promise<AppProcess> =>
	appProcessSpawn("src/worker.ts", options, {});
