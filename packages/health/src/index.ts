import { createServer } from "node:http";

export type HealthServer = {
	/** Marks the process ready; call it after every intake listens. */
	ready(): void;
	/** Stops listening; `server.close()` also drops idle keep-alive connections. */
	close(): Promise<void>;
	/** Calls close(), so `await using` closes the server when its block ends. */
	[Symbol.asyncDispose](): Promise<void>;
};

/**
 * Serves `/livez` and `/readyz` on its own port, on plain `node:http`.
 * Bodies are `ok` (200) or `unavailable` (503); any other path is 404.
 * `/readyz` is 503 until `ready()` and again once `isShuttingDown()` is true.
 * `/livez` is 200 while `isAlive()` is true.
 */
export const healthServerCreate = (options: {
	port: number;
	isShuttingDown: () => boolean;
	isAlive: () => boolean;
}): HealthServer => {
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

	// Longer than the 60 s a load balancer keeps an idle probe connection, like the app's server.
	server.keepAliveTimeout = 65_000;
	server.headersTimeout = 66_000;
	server.listen(options.port);

	const close = (): Promise<void> =>
		new Promise((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});

	return {
		close,
		[Symbol.asyncDispose]: close,
		ready: () => {
			isReady = true;
		},
	};
};
