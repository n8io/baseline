import { afterEach, describe, expect, inject, it } from "vitest";
import { integrationDatabaseCreate } from "./integration-database.ts";
import {
	productionServerConnectResult,
	productionServerStart,
	productionServerWaitFor,
	shutdownStarted,
	slowRequestStart,
} from "./production-server.ts";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("server shutdown on SIGTERM", { timeout: 30_000 }, () => {
	it("finishes an in-flight sign-in, answers /readyz 503, refuses new connections and exits 0", async () => {
		const { databaseUrl, drop } = await integrationDatabaseCreate();
		cleanups.push(drop);
		const server = await productionServerStart({
			cacheUrl: inject("integrationCacheUrl"),
			databaseUrl,
		});
		cleanups.push(server.stop);

		// The memory issuer's sign-in form needs no domain.
		const slow = await slowRequestStart(server.port, {
			body: new URLSearchParams({ who: "admin" }).toString(),
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				origin: server.url,
			},
			path: "/auth/sign-in",
		});
		// Runs before server.stop, which would otherwise wait for this request until its deadline.
		cleanups.push(async () => slow.abort());

		server.child.kill("SIGTERM");
		await shutdownStarted(server);
		await productionServerWaitFor(
			"new connections refused",
			async () =>
				(await productionServerConnectResult(server.port)) === "ECONNREFUSED",
		);
		expect(server.child.exitCode).toBeNull();

		const res = await slow.finish();

		expect(res.status).toBe(302);
		expect(res.headers["set-cookie"]?.join("\n")).toContain("__Host-authn=");
		expect(await server.exited).toBe(0);
	});
});
