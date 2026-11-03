import type { Server } from "node:http";

const idleCloseIntervalMs = 100;

/**
 * Stops accepting connections and resolves once every open request has finished. Idle keep-alive
 * sockets are closed every 100 ms; requests still running are never cut off here.
 */
export const httpServerClose = (server: Server): Promise<void> =>
	new Promise((resolve, reject) => {
		const interval = setInterval(
			() => server.closeIdleConnections(),
			idleCloseIntervalMs,
		);
		server.close((error) => {
			clearInterval(interval);
			if (error) reject(error);
			else resolve();
		});
	});
