import type { Server } from "node:http";

// Copied from packages/health/src/health-server.ts; keep the two in step.
const httpKeepAliveMs = 65_000;

/**
 * Keeps idle connections open for 65 s: longer than a load balancer or ingress keeps its own
 * (60 s is the usual default). On Node's 5 s default the balancer reuses a connection this server
 * has already closed, and the client gets a 502. The headers timeout stays above it.
 */
export const httpServerKeepAlive = (server: Server): void => {
	// mutates: Node reads the timeouts off the server object itself
	server.keepAliveTimeout = httpKeepAliveMs;
	// mutates: Node reads the timeouts off the server object itself
	server.headersTimeout = httpKeepAliveMs + 1_000;
};
