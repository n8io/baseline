// Composition root for pages, the API and live streams.
import type { Server } from "node:http";
import {
	authnCreate,
	authnMiddleware,
	authnRoutes,
} from "@n8io/baseline-authn";
import { cacheRedisClientCreate } from "@n8io/baseline-cache";
import { healthServerCreate } from "@n8io/baseline-health";
import {
	httpErrorHandle,
	httpNotFoundHandle,
	httpRouteName,
	httpRouterCreate,
	httpServerClose,
} from "@n8io/baseline-http";
import { liveMemory, liveRedis } from "@n8io/baseline-live";
import { logger } from "@n8io/baseline-logger";
import { postgresPoolCreate } from "@n8io/baseline-postgres";
import { consumersSubscribe, queueCreate } from "@n8io/baseline-queue";
import { type ShutdownHandle, shutdownHandle } from "@n8io/baseline-shutdown";
import {
	telemetryShutdown,
	telemetryUseCasesTrace,
} from "@n8io/baseline-telemetry";
import { except } from "hono/combine";
import { createHonoServer } from "react-router-hono-server/node";
import { actorFromClaims, authnProviderOptions } from "#authn";
import { fooLiveRoutes, fooRoutes } from "#domains/foo/api/index.ts";
import { fooScopes, fooUseCasesCreate } from "#domains/foo/index.ts";
import { fooPortsCreate } from "#domains/foo/spi/index.ts";
import { ENV, envLocal } from "#env";
import { loadContextCreate } from "#ui/context.ts";
import { seedsRun } from "./seed.ts";

// Development: the dev server re-runs this file after an edit, and import.meta.hot is
// undefined there, so each run first closes what the last one opened.
const devRun = globalThis as { serverDevClose?: () => Promise<void> };
if (import.meta.env.DEV) await devRun.serverDevClose?.();

let shutdown: ShutdownHandle | undefined;
const health = healthServerCreate({
	isAlive: () => true,
	isShuttingDown: () => shutdown?.isShuttingDown() ?? false,
	port: ENV.HEALTH_PORT,
});

const pgPool =
	ENV.DATABASE_URL === "memory://"
		? "memory"
		: postgresPoolCreate({ databaseUrl: ENV.DATABASE_URL });
const redisClient =
	ENV.CACHE_URL === "memory://"
		? "memory"
		: await cacheRedisClientCreate({ cacheUrl: ENV.CACHE_URL });
const queue =
	pgPool === "memory"
		? "memory"
		: await queueCreate({ pgPool, role: "publisher" });
const liveHub =
	redisClient === "memory" ? liveMemory() : liveRedis(redisClient);
if (import.meta.env.DEV) {
	// Shutdown order: intakes, then resources, health last.
	devRun.serverDevClose = async () => {
		await liveHub.close();
		if (queue !== "memory") await queue.stop();
		if (pgPool !== "memory") await pgPool.end();
		if (redisClient !== "memory") await redisClient.close();
		await health.close();
	};
}
const ports = { cache: redisClient, database: pgPool, liveHub, queue } as const;

const fooUseCases = telemetryUseCasesTrace(
	fooUseCasesCreate(fooPortsCreate(ports)),
);
// domain-create: use-cases
// domain-create: bridges

if (ENV.APP_ENV === "development" && pgPool === "memory") {
	await seedsRun({
		fooUseCases,
		// domain-create: seed-context
	});
}

// Creates queues and subscriptions; consumers run only in the worker.
if (queue !== "memory") {
	await consumersSubscribe(queue, [
		// domain-create: consumers
	]);
}

const authn = await authnCreate({
	...authnProviderOptions(ENV),
	actorFromClaims,
	memoryAdminScopes: [
		...fooScopes,
		// domain-create: scopes
	],
});

const app = httpRouterCreate();
app.use(httpRouteName);
app.onError(httpErrorHandle);
app.use("*", except(["/api/*"], authnMiddleware(authn, { source: "cookie" })));
app.use("/api/v1/*", authnMiddleware(authn, { source: "bearer" }));
app.route("/auth", authnRoutes(authn));
app.route("/api/v1/foos", fooRoutes(fooUseCases));
// domain-create: routes
app.route("/live/foo", fooLiveRoutes(fooUseCases, liveHub));
// domain-create: live
app.doc31("/api/v1/openapi.json", {
	info: { title: "app", version: "1" },
	openapi: "3.1.0",
});
// Unknown /api paths answer JSON, never a React Router page.
app.all("/api/*", httpNotFoundHandle);

export default await createHonoServer({
	app,
	// hono/logger would log every path and query; the HTTP spans and httpErrorHandle cover requests.
	defaultLogger: false,
	getLoadContext: (c) =>
		loadContextCreate(c, {
			fooUseCases,
			// domain-create: context
		}),
	listeningListener: ({ port }) => logger.info({ port }, "Server listening"),
	onServe: (server) => {
		// Development: Vite owns the server and Ctrl-C.
		if (!import.meta.env.PROD) return health.ready();
		shutdown = shutdownHandle({
			drainDelayMs: envLocal ? 0 : 5_000,
			intakes: [
				{ close: () => httpServerClose(server as Server), name: "http" },
				{ close: () => liveHub.close(), name: "live" },
			],
			resources: [
				{
					close: () => (queue === "memory" ? Promise.resolve() : queue.stop()),
					name: "queue",
				},
				{
					close: () => (pgPool === "memory" ? Promise.resolve() : pgPool.end()),
					name: "database",
				},
				{
					close: () =>
						redisClient === "memory" ? Promise.resolve() : redisClient.close(),
					name: "cache",
				},
				{ close: () => health.close(), name: "health" },
				{ close: () => telemetryShutdown(), name: "telemetry" },
			],
		});
		health.ready();
	},
	port: ENV.PORT,
});
