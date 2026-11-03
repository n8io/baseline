import { type ChildProcess, spawn } from "node:child_process";
import { createDecipheriv, hkdfSync } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createServer as netServerCreate } from "node:net";

// Every entry in the image starts with these, varlock first (spec 14.3).
const preloadFlags = [
	"--import",
	"varlock/auto-load",
	"--import",
	"@n8io/baseline-telemetry/register",
	"--experimental-loader=@opentelemetry/instrumentation/hook.mjs",
];

const serverEntry = "build/server/index.js";

export const freePort = async (): Promise<number> => {
	const server = netServerCreate().listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	server.close();
	if (address === null || typeof address === "string") {
		throw new Error("no free port");
	}
	return address.port;
};

export const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

// Polls `check` every 50 ms until it returns true, or throws `what` after `timeoutMs`.
export const waitFor = async (
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
	const exited = once(child, "exit").then(([code]) => code as number | null);
	return {
		child,
		exited,
		healthPort,
		stderr: () => stderr,
		stdout: () => stdout,
		stop: async () => {
			if (child.exitCode === null && child.signalCode === null) {
				child.kill("SIGTERM");
			}
			return exited;
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
		await waitFor(
			`${entry} /readyz 200`,
			async () => {
				if (app.child.exitCode !== null) {
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

const httpStatus = async (
	port: number,
	path: string,
): Promise<number | undefined> => {
	const res = await fetch(`http://127.0.0.1:${port}${path}`).catch(
		() => undefined,
	);
	await res?.body?.cancel();
	return res?.status;
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
	await waitFor("the server on PORT", async () => {
		return (await httpStatus(port, "/auth/sign-in")) === 200;
	});
	return { ...app, port, url: `http://127.0.0.1:${port}` };
};

/** Boots `src/worker.ts` as native TS with the same preloads; resolves once /readyz is 200. */
export const workerStart = (options: AppProcessOptions): Promise<AppProcess> =>
	appProcessStart("src/worker.ts", options, {});

/** Starts the worker without waiting for readiness, for boots that are meant to fail. */
export const workerSpawn = (options: AppProcessOptions): Promise<AppProcess> =>
	appProcessSpawn("src/worker.ts", options, {});

// The access cookie is a JWE (dir, A256GCM) of the provider's access token, keyed from
// AUTHN_SECRET the way @n8io/baseline-authn derives it.
const accessTokenFromCookie = (sealed: string): string => {
	const secret = process.env.AUTHN_SECRET;
	if (secret === undefined) throw new Error("AUTHN_SECRET is not loaded");
	const key = hkdfSync(
		"sha256",
		Buffer.from(secret, "base64url"),
		"",
		"baseline-authn cookie",
		32,
	);
	const [header = "", , iv = "", ciphertext = "", tag = ""] = sealed.split(".");
	const decipher = createDecipheriv(
		"aes-256-gcm",
		Buffer.from(key),
		Buffer.from(iv, "base64url"),
	);
	decipher.setAAD(Buffer.from(header, "ascii"));
	decipher.setAuthTag(Buffer.from(tag, "base64url"));
	const payload = Buffer.concat([
		decipher.update(Buffer.from(ciphertext, "base64url")),
		decipher.final(),
	]).toString("utf8");
	return (JSON.parse(payload) as { v: string }).v;
};

export type SignedIn = {
	/** The access cookie's sealed value, to search telemetry for. */
	accessCookie: string;
	/** `Authorization` header value for /api/v1. */
	authorization: string;
	/** `Cookie` header value for pages and live streams. */
	cookie: string;
	/** The access token inside the cookie (signed by this server's memory issuer). */
	token: string;
};

/** Signs in through the memory issuer's form; each server instance signs its own tokens. */
export const signIn = async (
	url: string,
	who: "admin" | "user" = "admin",
): Promise<SignedIn> => {
	const res = await fetch(`${url}/auth/sign-in`, {
		body: new URLSearchParams({ who }),
		method: "POST",
		redirect: "manual",
	});
	await res.body?.cancel();
	const pairs = res.headers.getSetCookie().map((line) => line.split(";")[0]);
	const access = pairs.find((pair) => pair?.startsWith("__Host-authn="));
	if (access === undefined) throw new Error(`sign-in failed: ${res.status}`);
	const accessCookie = access.slice("__Host-authn=".length);
	const token = accessTokenFromCookie(accessCookie);
	return {
		accessCookie,
		authorization: `Bearer ${token}`,
		cookie: pairs.join("; "),
		token,
	};
};

export type OtlpAttribute = {
	key: string;
	value: { intValue?: number | string; stringValue?: string };
};

export type OtlpSpan = {
	attributes: OtlpAttribute[];
	kind: number;
	name: string;
	parentSpanId?: string;
	spanId: string;
	traceId: string;
};

export type OtlpReceiver = {
	close: () => Promise<void>;
	/** Every request body by signal path: /v1/traces, /v1/logs, /v1/metrics. */
	bodies: Record<string, string[]>;
	endpoint: string;
	spans: () => OtlpSpan[];
};

/** A small OTLP/HTTP JSON receiver inside the test that keeps every body it is sent. */
export const otlpReceiverStart = async (): Promise<OtlpReceiver> => {
	const bodies: Record<string, string[]> = {};
	const server: Server = createServer(async (request, response) => {
		let body = "";
		for await (const chunk of request) body += chunk;
		const path = request.url ?? "";
		bodies[path] = [...(bodies[path] ?? []), body];
		response.writeHead(200, { "content-type": "application/json" }).end("{}");
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (address === null || typeof address === "string") {
		throw new Error("no receiver port");
	}
	return {
		bodies,
		close: () =>
			new Promise((resolve) => {
				server.close(() => resolve());
			}),
		endpoint: `http://127.0.0.1:${address.port}`,
		spans: () =>
			(bodies["/v1/traces"] ?? []).flatMap((body) =>
				(
					JSON.parse(body) as {
						resourceSpans: { scopeSpans: { spans: OtlpSpan[] }[] }[];
					}
				).resourceSpans.flatMap((resource) =>
					resource.scopeSpans.flatMap((scope) => scope.spans),
				),
			),
	};
};

/** OTLP/HTTP JSON export settings for a child process, with short batch delays. */
export const otlpEnv = (receiver: OtlpReceiver): Record<string, string> => ({
	OTEL_BLRP_SCHEDULE_DELAY: "100",
	OTEL_BSP_SCHEDULE_DELAY: "100",
	OTEL_EXPORTER_OTLP_ENDPOINT: receiver.endpoint,
	OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
	OTEL_LOGS_EXPORTER: "otlp",
	OTEL_METRIC_EXPORT_INTERVAL: "1000",
	OTEL_METRICS_EXPORTER: "otlp",
	OTEL_TRACES_EXPORTER: "otlp",
});

/** The ancestors of `span` in `spans`, nearest first. */
export const spanAncestors = (
	span: OtlpSpan,
	spans: OtlpSpan[],
): OtlpSpan[] => {
	const ancestors: OtlpSpan[] = [];
	let parentId = span.parentSpanId;
	while (parentId) {
		const parent = spans.find(
			(item) => item.spanId === parentId && item.traceId === span.traceId,
		);
		if (parent === undefined) break;
		ancestors.push(parent);
		parentId = parent.parentSpanId;
	}
	return ancestors;
};

export const spanAttribute = (
	span: OtlpSpan,
	key: string,
): string | undefined => {
	const value = span.attributes.find((item) => item.key === key)?.value;
	return value?.stringValue ?? value?.intValue?.toString();
};
