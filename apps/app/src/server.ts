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
	httpServerKeepAlive,
} from "@n8io/baseline-http";
import { logger } from "@n8io/baseline-logger";
import {
	type ShutdownHandle,
	shutdownHandleCreate,
} from "@n8io/baseline-shutdown";
import { telemetryShutdown } from "@n8io/baseline-telemetry";
import { bodyLimit } from "hono/body-limit";
import { except } from "hono/combine";
import { createHonoServer } from "react-router-hono-server/node";
import {
	actorFromClaims,
	authnMemoryClientsCreate,
	authnMemoryUsersCreate,
	authnProviderOptionsCreate,
} from "#authn";
import { fooScopes } from "#contexts/foo/index.ts";
import { ENV, envLocal } from "#env";
import { uiLoadContextCreate } from "#ui/context.ts";
import { serverDevCloseCreate } from "#ui/server-dev-close.ts";
import packageJson from "../package.json" with { type: "json" };
import { apiReferenceRoutesCreate } from "./api-reference.ts";
import { connectionsOpen } from "./connections.ts";
import { seedsRun } from "./seed.ts";
import { type ContextMounts, contextsCreate } from "./use-cases.ts";

// piece-start: ui
// Development: the dev server re-runs this file after an edit, and import.meta.hot is
// undefined there, so each run first closes what the last one opened.
const devRun = globalThis as { serverDevClose?: () => Promise<void> };
if (import.meta.env.DEV) await devRun.serverDevClose?.();
// piece-end: ui

let shutdown: ShutdownHandle | undefined;
// The startup check: connectionsOpen throws while Postgres is unreachable, so the health port
// opens only after it and /livez never answers for a Server that cannot start.
const connections = await connectionsOpen({ role: "publisher" }).catch(
	(error) => {
		logger.fatal({ err: error }, "Boot failed: a connection did not open");
		process.exit(1);
	},
);
const health = healthServerCreate({
	isAlive: () => true,
	isShuttingDown: () => shutdown?.isShuttingDown() ?? false,
	port: ENV.HEALTH_PORT,
});
// piece-start: ui
if (import.meta.env.DEV) {
	devRun.serverDevClose = serverDevCloseCreate({ connections, health });
}
// piece-end: ui
// wiring: contexts-start
const contexts = contextsCreate(connections);
// wiring: contexts-end
// Every context, built in order; the Server mounts what each returns.
const mounts: ContextMounts[] = [
	// wiring: contexts-start
	...Object.values(contexts),
	// wiring: contexts-end
];
if (ENV.APP_ENV === "development" && connections.database === "memory") {
	await seedsRun(mounts);
}

// piece-start: queue
// Creates queues and subscriptions; consumers run only in the worker.
if (connections.events !== "memory") {
	await connections.events.consumersSubscribe(
		mounts.flatMap((m) => m.handlers),
	);
}
// piece-end: queue

// Every scope the Template's contexts define; the dev admin and the dev client hold all of them.
const scopes: string[] = [
	...fooScopes,
	// wiring: scopes
];
const authn = await authnCreate({
	...authnProviderOptionsCreate(ENV),
	actorFromClaims,
	memoryClients: authnMemoryClientsCreate(scopes),
	memoryUsers: authnMemoryUsersCreate(scopes),
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
	except(
		["/api/v1/openapi.json", "/api/v1/docs", "/api/v1/docs/*"],
		async (c, next) => {
			authnActorRequire(c);
			await next();
		},
	),
);
app.route("/auth", authnRoutesCreate(authn));
for (const { path, router } of mounts.flatMap((m) => m.routes)) {
	app.route(path, router);
}
// piece-start: api-reference
// Public like openapi.json (the guard above exempts /api/v1/docs); without this piece it is a 404.
app.route("/api/v1/docs", apiReferenceRoutesCreate());
// piece-end: api-reference
// Every operation needs a bearer token, which the API reference page's Authorize button takes.
app.openAPIRegistry.registerComponent("securitySchemes", "bearer", {
	bearerFormat: "JWT",
	scheme: "bearer",
	type: "http",
});
app.doc31("/api/v1/openapi.json", {
	info: { title: packageJson.name, version: "1" },
	openapi: "3.1.0",
	security: [{ bearer: [] }],
});
// Unknown /api paths answer JSON, never a page.
app.all("/api/*", httpNotFoundHandle);

// Outlasts the load balancer's idle timeout and starts graceful shutdown on SIGTERM;
// serverListening reports ready.
const serverServe = (server: Server) => {
	httpServerKeepAlive(server);
	shutdown = shutdownHandleCreate({
		drainDelayMs: ENV.SHUTDOWN_DRAIN_DELAY_MS ?? 5_000,
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
			// wiring: contexts-start
			contexts,
			// wiring: contexts-end
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
