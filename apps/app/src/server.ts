// Entry point for the HTTP server: the API, sign-in, pages and live streams. A block marked
// with a Piece's name belongs to that Piece; `pnpm piece-remove` takes it out.
import type { Server } from "node:http";
import {
	authnActorRequire,
	authnCreate,
	authnMiddlewareCreate,
	authnRoutesCreate,
} from "@n8io/baseline-authn";
import { featureFlagsLaunchDarklyClientOrigins } from "@n8io/baseline-feature-flags/launchdarkly/origins";
import { healthServerCreate } from "@n8io/baseline-health";
import {
	httpCsrf,
	httpErrorHandle,
	httpNotFoundHandle,
	httpRouteName,
	httpRouterCreate,
	httpSecureHeadersCreate,
	httpServerClose,
	httpServerKeepAlive,
} from "@n8io/baseline-http";
import { loggerCreate } from "@n8io/baseline-logger";
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
import { featureFlagsClientSideIdContext } from "#ui/feature-flags-client-config.ts";
import { serverDevCloseCreate } from "#ui/server-dev-close.ts";
import packageJson from "../package.json" with { type: "json" };
import { apiReferenceRoutesCreate } from "./api-reference.ts";
import { connectionsOpen } from "./connections.ts";
import { type ContextMounts, contextsCreate } from "./contexts.ts";
import { seedsRun } from "./seed.ts";

const logger = loggerCreate();

// The Hono app: its middleware in order, then every context's routes, the API reference and the
// OpenAPI document.
const appCreate = ({
	authn,
	mounts,
}: {
	authn: Awaited<ReturnType<typeof authnCreate>>;
	mounts: ContextMounts[];
}) => {
	const app = httpRouterCreate();
	app.use(httpRouteName);
	app.onError(httpErrorHandle);
	app.use(
		httpSecureHeadersCreate({
			// piece-start: feature-flags
			// The browser's flag client talks to LaunchDarkly directly, so the CSP must allow its origins.
			// Without a client-side ID there is no client, so nothing is allowed.
			connectSrc: ENV.LAUNCHDARKLY_CLIENT_SIDE_ID
				? featureFlagsLaunchDarklyClientOrigins()
				: null,
			// piece-end: feature-flags
		}),
	);
	// bodyLimit reads a body with no Content-Length (a DELETE with no body, a chunked POST) and copies
	// the request with `new Request(raw, init)`. The Node adapter's request is not a native Request, so
	// that copy throws ERR_INVALID_URL: give bodyLimit a native one (n8io/baseline#485). Drop this once
	// hono's bodyLimit or the Node adapter can copy the adapter's request.
	app.use("/api/*", async (c, next) => {
		const { body, headers, method, signal, url } = c.req.raw;
		if (
			body &&
			(!headers.has("content-length") || headers.has("transfer-encoding"))
		) {
			const init: RequestInit & { duplex: "half" } = {
				body,
				duplex: "half",
				headers,
				method,
				signal,
			};
			// mutates: Hono has no other way to give later handlers the replayed body
			c.req.raw = new Request(url, init);
		}
		await next();
	});
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
	// Public like openapi.json (the guard above exempts /api/v1/docs); without this Piece it is a 404.
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
	return app;
};

// The startup check, the connections, the health port and the app, wired. Nothing runs until it
// is called, so importing this file opens nothing.
const serverCreate = async () => {
	// piece-start: ui
	// Development: the dev server re-runs this file after an edit, and import.meta.hot is
	// undefined there, so each run first closes what the last one opened.
	const devRun = globalThis as { serverDevClose?: () => Promise<void> };
	if (import.meta.env.DEV) await devRun.serverDevClose?.();
	// piece-end: ui
	// The shutdown handle needs the health port, which asks it whether it is shutting down.
	const shutdownRef: { current?: ShutdownHandle } = {};
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
		isShuttingDown: () => shutdownRef.current?.isShuttingDown() ?? false,
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
	// Creates queues and subscriptions; Event handlers run only in the Worker.
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
	return {
		app: appCreate({ authn, mounts }),
		health,
		// wiring: contexts-start
		contexts,
		// wiring: contexts-end
		// Ready only once PORT is bound. A listen error such as EADDRINUSE never gets here: it
		// reaches the shutdown handle's uncaughtException handler, which logs it and exits 1.
		serverListening: ({ port }: { port: number }) => {
			health.ready();
			logger.info({ port }, "Server listening and ready");
		},
		// Outlasts the load balancer's idle timeout and starts graceful shutdown on SIGTERM;
		// serverListening reports ready.
		serverServe: (server: Server) => {
			httpServerKeepAlive(server);
			shutdownRef.current = shutdownHandleCreate({
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
		},
	};
};

// piece-start: ui
// React Router serves the pages and hosts app: Vite in development, its build in production.
// serverStart boots the server and hands the Hono app to React Router's server; the entry point
// calls it, and its promise is the default export, which react-router-hono-server awaits.
const serverStart = async () => {
	const booted = await serverCreate();
	const {
		app,
		health,
		// wiring: contexts-start
		contexts,
		// wiring: contexts-end
		serverListening,
		serverServe,
	} = booted;
	return createHonoServer({
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
		getLoadContext: (c) => {
			const loadContext = uiLoadContextCreate(
				c,
				// wiring: contexts-start
				contexts,
				// wiring: contexts-end
			);
			// piece-start: feature-flags
			loadContext.set(
				featureFlagsClientSideIdContext,
				ENV.LAUNCHDARKLY_CLIENT_SIDE_ID || null,
			);
			// piece-end: feature-flags
			return loadContext;
		},
		listeningListener: serverListening,
		onServe: (node) => {
			// Development: Vite owns the server and Ctrl-C.
			if (!import.meta.env.PROD) return health.ready();
			serverServe(node as Server);
		},
		port: ENV.PORT,
	});
};

export default serverStart();
// piece-end: ui
