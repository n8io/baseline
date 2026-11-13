// Composition root for the HTTP server: the API, sign-in, pages and live streams. A block marked
// with a piece's name belongs to that piece; `pnpm piece-remove` takes it out.
import type { Server } from "node:http";
import {
	authnActorRequire,
	authnCreate,
	authnMiddlewareCreate,
	authnRoutesCreate,
} from "@n8io/baseline-authn";
import { healthServerCreate } from "@n8io/baseline-health";
import {
	httpCsrf,
	httpErrorHandle,
	httpNotFoundHandle,
	httpRouteName,
	httpRouterCreate,
	httpSecureHeaders,
	httpServerClose,
} from "@n8io/baseline-http";
import { logger } from "@n8io/baseline-logger";
import {
	type ShutdownHandle,
	shutdownHandleCreate,
} from "@n8io/baseline-shutdown";
import {
	telemetryShutdown,
	telemetryUseCasesTrace,
} from "@n8io/baseline-telemetry";
import { bodyLimit } from "hono/body-limit";
import { except } from "hono/combine";
import { createHonoServer } from "react-router-hono-server/node";
import { actorFromClaims, authnProviderOptionsCreate } from "#authn";
import {
	fooLiveRoutesCreate,
	fooRoutesCreate,
} from "#domains/foo/api/index.ts";
import { fooScopes, fooUseCasesCreate } from "#domains/foo/index.ts";
import { fooPortsCreate } from "#domains/foo/spi/index.ts";
import { ENV, envLocal } from "#env";
import { uiLoadContextCreate } from "#ui/context.ts";
import { connectionsOpen } from "./connections.ts";
import { seedsRun } from "./seed.ts";

// piece-start: ui
// Development: the dev server re-runs this file after an edit, and import.meta.hot is
// undefined there, so each run first closes what the last one opened.
const devRun = globalThis as { serverDevClose?: () => Promise<void> };
if (import.meta.env.DEV) await devRun.serverDevClose?.();
// piece-end: ui

let shutdown: ShutdownHandle | undefined;
const health = healthServerCreate({
	isAlive: () => true,
	isShuttingDown: () => shutdown?.isShuttingDown() ?? false,
	port: ENV.HEALTH_PORT,
});
const connections = await connectionsOpen({ role: "publisher" });
// piece-start: ui
if (import.meta.env.DEV) {
	// Shutdown order: intakes, then resources, health last.
	devRun.serverDevClose = async () => {
		for (const step of [...connections.intakes, ...connections.resources]) {
			await step.close();
		}
		await health.close();
	};
}
// piece-end: ui
// domain-create: domains-start
const fooUseCases = telemetryUseCasesTrace(
	fooUseCasesCreate(fooPortsCreate(connections)),
);
// domain-create: use-cases
// domain-create: bridges

if (ENV.APP_ENV === "development" && connections.database === "memory") {
	await seedsRun({
		fooUseCases,
		// domain-create: seed-context
	});
}
// domain-create: domains-end

// piece-start: queue
// Creates queues and subscriptions; consumers run only in the worker.
if (connections.events !== "memory") {
	await connections.events.consumersSubscribe([
		// domain-create: consumers
	]);
}
// piece-end: queue

const authn = await authnCreate({
	...authnProviderOptionsCreate(ENV),
	actorFromClaims,
	memoryAdminScopes: [
		...fooScopes,
		// domain-create: scopes
	],
	memoryIssuerAllowed: envLocal,
});

export const app = httpRouterCreate();
app.use(httpRouteName);
app.onError(httpErrorHandle);
app.use(httpSecureHeaders);
// A body over 1 MB throws a 413 that httpErrorHandle answers as PayloadTooLarge.
app.use("/api/*", bodyLimit({ maxSize: 1024 * 1024 }));
// Cookies ride along on a cross-site request, so cookie routes refuse one; /api uses bearer tokens.
app.use("*", except(["/api/*"], httpCsrf));
app.use(
	"*",
	except(["/api/*"], authnMiddlewareCreate(authn, { source: "cookie" })),
);
app.use("/api/v1/*", authnMiddlewareCreate(authn, { source: "bearer" }));
// No Actor, no API: an anonymous request gets 401 before any route validates its input.
app.use(
	"/api/v1/*",
	except("/api/v1/openapi.json", async (c, next) => {
		authnActorRequire(c);
		await next();
	}),
);
app.route("/auth", authnRoutesCreate(authn));
app.route("/api/v1/foos", fooRoutesCreate(fooUseCases));
// domain-create: routes
// piece-start: live
app.route("/live/foo", fooLiveRoutesCreate(fooUseCases, connections.liveHub));
// domain-create: live
// piece-end: live
app.doc31("/api/v1/openapi.json", {
	info: { title: "app", version: "1" },
	openapi: "3.1.0",
});
// Unknown /api paths answer JSON, never a page.
app.all("/api/*", httpNotFoundHandle);

// Starts graceful shutdown on SIGTERM; serverListening reports ready.
const serverServe = (server: Server) => {
	shutdown = shutdownHandleCreate({
		drainDelayMs: envLocal ? 0 : 5_000,
		intakes: [
			{ close: () => httpServerClose(server), name: "http" },
			...connections.intakes,
		],
		resources: [
			...connections.resources,
			{ close: () => health.close(), name: "health" },
			{ close: () => telemetryShutdown(), name: "telemetry" },
		],
	});
};
// Ready only once PORT is bound. A listen error such as EADDRINUSE never gets here: it reaches
// the shutdown handle's uncaughtException handler, which logs it and exits 1.
const serverListening = ({ port }: { port: number }) => {
	health.ready();
	logger.info({ port }, "Server listening and ready");
};

// piece-start: ui
// React Router serves the pages and hosts app: Vite in development, its build in production.
export default await createHonoServer({
	app,
	// Mid-rollout, a page from another version's pod asks this one for hashed files it lacks. A
	// bare 404 nothing may cache, so a retry can reach a pod that has the file.
	configure: (server) => {
		server.all("/assets/*", (c) =>
			c.text("Not Found", 404, { "cache-control": "no-store" }),
		);
	},
	// hono/logger would log every path and query; the HTTP spans and httpErrorHandle cover requests.
	defaultLogger: false,
	getLoadContext: (c) =>
		uiLoadContextCreate(
			c,
			// domain-create: domains-start
			{
				fooUseCases,
				// domain-create: context
			},
			// domain-create: domains-end
		),
	listeningListener: serverListening,
	onServe: (server) => {
		// Development: Vite owns the server and Ctrl-C.
		if (!import.meta.env.PROD) return health.ready();
		serverServe(server as Server);
	},
	port: ENV.PORT,
});
// piece-end: ui
