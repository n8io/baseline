import { createServer } from "node:http";

/** The probe server `healthServerCreate` starts. */
export type HealthServer = {
	/** Marks the process ready; call it after every intake listens. */
	ready(): void;
	/** Stops listening and drops every open connection. */
	close(): Promise<void>;
	/** Calls close(), so `await using` closes the server when its block ends. */
	[Symbol.asyncDispose](): Promise<void>;
};

/** What `healthServerCreate` takes. */
export type HealthServerOptions = {
	/** The port the probes listen on; the Template's convention is `HEALTH_PORT` (default 9000). */
	port: number;
	/** True once shutdown starts: `/readyz` turns 503. */
	isShuttingDown: () => boolean;
	/** False when only a restart fixes the process: `/livez` turns 503. */
	isAlive: () => boolean;
};

/**
 * Serves `/livez` and `/readyz` on its own port, on plain `node:http`.
 * Bodies are `ok` (200) or `unavailable` (503); any other path is 404.
 * `/readyz` is 503 until `ready()` and again once `isShuttingDown()` is true.
 * `/livez` is 200 while `isAlive()` is true. Throws `TypeError` on a `port` outside 0 to 65535.
 */
export const healthServerCreate = (
	options: HealthServerOptions,
): HealthServer => {
	if (
		!Number.isInteger(options.port) ||
		options.port < 0 ||
		options.port > 65_535
	) {
		throw new TypeError(
			"healthServerCreate: port must be an integer from 0 to 65535",
		);
	}
	let isReady = false;

	const server = createServer((request, response) => {
		const path = request.url?.split("?", 1)[0];
		const healthy =
			path === "/livez"
				? options.isAlive()
				: path === "/readyz"
					? isReady && !options.isShuttingDown()
					: undefined;

		if (healthy === undefined) {
			response
				.writeHead(404, { "content-type": "text/plain" })
				.end("not found");
			return;
		}

		response
			.writeHead(healthy ? 200 : 503, { "content-type": "text/plain" })
			.end(healthy ? "ok" : "unavailable");
	});

	// Longer than the 60 s a load balancer keeps an idle probe connection, like the Project's Server.
	// Copied from packages/http/src/http-server-keep-alive.ts; keep the two in step.
	server.keepAliveTimeout = 65_000;
	server.headersTimeout = 66_000;
	server.listen(options.port);

	const close = (): Promise<void> =>
		new Promise((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
			// A connection that is not idle right now would otherwise hold close() for 65 s.
			server.closeAllConnections();
		});

	return {
		close,
		[Symbol.asyncDispose]: close,
		ready: () => {
			isReady = true;
		},
	};
};
