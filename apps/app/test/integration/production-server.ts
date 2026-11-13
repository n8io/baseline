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
import { inject } from "vitest";

// The preload every entry runs; the image sets it in NODE_OPTIONS.
const preloadFlags = ["--import", "./src/preload.ts"];

const serverEntry = "build/server/index.js";

// Ports come from a block this Vitest worker owns, below the kernel's ephemeral range (32768 and
// up on Linux, 49152 on macOS). A listen(0) port is free only until the probe closes it: the child
// binds it seconds later, and any other process's listen(0) can get it first. Then the server's
// listen fails with EADDRINUSE and it exits 1.
const portBlockSize = 100;
const portBlockStart =
	20_000 + Number(process.env.VITEST_POOL_ID ?? 0) * portBlockSize;
let portNext = 0;

// The next port of this worker's block that nothing listens on, e.g. a child an earlier file leaked.
const portClaim = async (): Promise<number> => {
	for (let tries = 0; tries < portBlockSize; tries++) {
		const port = portBlockStart + (portNext++ % portBlockSize);
		const probe = netServerCreate().listen(port);
		// once() rejects when the probe emits "error" (EADDRINUSE) first.
		const free = await once(probe, "listening").then(
			() => true,
			() => false,
		);
		if (free) {
			await new Promise((resolve) => probe.close(resolve));
			return port;
		}
	}
	throw new Error(
		`no free port in ${portBlockStart}-${portBlockStart + portBlockSize - 1}`,
	);
};

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

// Polls `check` every 50 ms until it returns true, or throws `what` after `timeoutMs`.
export const productionServerWaitFor = async ({
	check,
	timeoutMs = 10_000,
	what,
}: {
	check: () => Promise<boolean> | boolean;
	timeoutMs?: number;
	what: string;
}): Promise<void> => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await check()) return;
		await sleep(50);
	}
	throw new Error(`timed out waiting for ${what}`);
};

/** `await using` stops the process at the end of the block, like `stop`. */
export type AppProcess = AsyncDisposable & {
	child: ChildProcess;
	/** Resolves with the exit code once the process has exited. */
	exited: Promise<number | null>;
	healthPort: number;
	stderr: () => string;
	stdout: () => string;
	/** Sends SIGTERM unless it has already exited, and resolves with the exit code. Safe to call again. */
	stop: () => Promise<number | null>;
};

type AppProcessOptions = {
	databaseUrl: string;
	/** Overrides, e.g. LOG_LEVEL or OTEL_* for the telemetry test. */
	env?: Record<string, string>;
};

const hasExited = (child: ChildProcess): boolean =>
	child.exitCode !== null || child.signalCode !== null;

// Spawns the entry with the image's preloads and env; does not wait for anything.
const appProcessSpawn = async ({
	entry,
	extraEnv,
	options: { databaseUrl, env = {} },
}: {
	entry: string;
	extraEnv: Record<string, string>;
	options: AppProcessOptions;
}): Promise<AppProcess> => {
	const healthPort = await portClaim();
	const child = spawn(process.execPath, [...preloadFlags, entry], {
		env: {
			...process.env,
			// The Vitest worker's serialized varlock env would win over every override below.
			__VARLOCK_ENV: undefined,
			APP_ENV: "test",
			// piece-start: redis
			CACHE_URL: inject("integrationCacheUrl"),
			// piece-end: redis
			DATABASE_URL: databaseUrl,
			HEALTH_PORT: String(healthPort),
			// A crash logs at fatal and then exits; anything quieter would hide why.
			LOG_LEVEL: "fatal",
			// The production build listens on PORT; development leaves that to Vite.
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
	const stop = async () => {
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
	};
	return {
		child,
		exited,
		healthPort,
		stderr: () => stderr,
		stdout: () => stdout,
		stop,
		[Symbol.asyncDispose]: async () => {
			await stop();
		},
	};
};

// The error for a child that exited while a test waited for it to start, with everything it said.
const appProcessExitError = async ({
	app,
	entry,
	waitingFor,
}: {
	app: AppProcess;
	entry: string;
	waitingFor: string;
}): Promise<Error> => {
	// "close" waits for stdout and stderr to drain, so the last lines are in.
	const code = await app.exited;
	return new Error(
		`${entry} exited before ${waitingFor}: code ${code}, signal ${app.child.signalCode}\n` +
			`stdout:\n${app.stdout()}\nstderr:\n${app.stderr()}`,
	);
};

// Waits until `check` passes; throws the exit report as soon as the child exits.
const appProcessWaitFor = ({
	app,
	check,
	entry,
	waitingFor,
}: {
	app: AppProcess;
	check: () => Promise<boolean>;
	entry: string;
	waitingFor: string;
}): Promise<void> =>
	productionServerWaitFor({
		what: waitingFor,
		check: async () => {
			if (hasExited(app.child)) {
				throw await appProcessExitError({ app, entry, waitingFor });
			}
			return check();
		},
		timeoutMs: 20_000,
	});

const appProcessStart = async ({
	entry,
	extraEnv,
	options,
}: {
	entry: string;
	extraEnv: Record<string, string>;
	options: AppProcessOptions;
}): Promise<AppProcess> => {
	const app = await appProcessSpawn({ entry, options, extraEnv });
	try {
		await appProcessWaitFor({
			app,
			entry,
			waitingFor: "/readyz answered 200",
			check: async () => (await httpStatus(app.healthPort, "/readyz")) === 200,
		});
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
	productionServerWaitFor({
		what: "/readyz 503",
		check: async () => {
			if (hasExited(app.child)) {
				throw new Error("exited before /readyz answered 503");
			}
			return (await httpStatus(app.healthPort, "/readyz")) === 503;
		},
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

/** `using` drops the request at the end of the block; declare it after the server it targets. */
type SlowRequest = Disposable & {
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
	const abort = () => {
		slow.destroy();
	};
	return {
		[Symbol.dispose]: abort,
		abort,
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

const serverEntryCheck = () => {
	if (!existsSync(serverEntry)) {
		throw new Error(`${serverEntry} is missing: run pnpm build first`);
	}
};

/** Starts the production build on `PORT` without waiting for readiness, for boots that are meant to fail. */
export const productionServerSpawn = (
	options: AppProcessOptions,
): Promise<AppProcess> => {
	serverEntryCheck();
	return appProcessSpawn({ entry: serverEntry, options, extraEnv: {} });
};

/**
 * Boots the production build (`pnpm build` output) the way the image runs it: the three
 * preload flags, NODE_ENV=production, APP_ENV=test, real Postgres and Redis, the memory issuer.
 * Resolves once /readyz answers 200 and the server answers on PORT.
 */
export const productionServerStart = async (
	options: AppProcessOptions,
): Promise<ProductionServer> => {
	serverEntryCheck();
	const port = await portClaim();
	const app = await appProcessStart({
		entry: serverEntry,
		options,
		extraEnv: {
			PORT: String(port),
		},
	});
	try {
		await appProcessWaitFor({
			app,
			entry: serverEntry,
			waitingFor: "PORT answered 200",
			check: async () => (await httpStatus(port, "/auth/sign-in")) === 200,
		});
	} catch (error) {
		await app.stop();
		throw error;
	}
	return { ...app, port, url: `http://127.0.0.1:${port}` };
};

// piece-start: queue
/** Boots `src/worker.ts` as native TS with the same preloads; resolves once /readyz is 200. */
export const workerStart = (options: AppProcessOptions): Promise<AppProcess> =>
	appProcessStart({ entry: "src/worker.ts", options, extraEnv: {} });

/** Starts the worker without waiting for readiness, for boots that are meant to fail. */
export const workerSpawn = (options: AppProcessOptions): Promise<AppProcess> =>
	appProcessSpawn({ entry: "src/worker.ts", options, extraEnv: {} });
// piece-end: queue
