import type { Server } from "node:http";

const keepAliveMs = 65_000;

/**
 * Keeps idle connections open for 65 s: longer than a load balancer or ingress keeps its own
 * (60 s is the usual default). On Node's 5 s default the balancer reuses a connection this server
 * has already closed, and the client gets a 502. Raise the balancer's idle timeout past 65 s and
 * the 502s come back. The headers timeout stays above it, so no request is cut off sooner than an
 * idle connection.
 */
export const httpServerKeepAlive = (server: Server): void => {
	server.keepAliveTimeout = keepAliveMs;
	server.headersTimeout = keepAliveMs + 1_000;
};
