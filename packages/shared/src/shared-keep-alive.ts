/** How long a server keeps an idle connection open: longer than the 60 s a load balancer keeps its own. */
const keepAliveMs = 65_000;

/**
 * Keeps idle connections open for 65 s. On Node's 5 s default a balancer reuses a connection this
 * server has already closed, and the client gets a 502. The headers timeout stays above it.
 */
export const sharedKeepAlive = (server: {
	headersTimeout: number;
	keepAliveTimeout: number;
}): void => {
	// mutates: Node reads the timeouts off the server object itself
	server.keepAliveTimeout = keepAliveMs;
	// mutates: Node reads the timeouts off the server object itself
	server.headersTimeout = keepAliveMs + 1_000;
};
