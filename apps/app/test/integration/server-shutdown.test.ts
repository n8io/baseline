import { describe, expect, it } from "vitest";
import { integrationDatabaseCreate } from "./integration-database.ts";
import {
	productionServerConnectResult,
	productionServerStart,
	productionServerWaitFor,
	shutdownStarted,
	slowRequestStart,
} from "./production-server.ts";

describe("server shutdown on SIGTERM", { timeout: 60_000 }, () => {
	it("keeps accepting connections for SHUTDOWN_DRAIN_DELAY_MS while /readyz answers 503, even under APP_ENV=test", async () => {
		const drainMs = 1_500;
		await using server = await productionServerStart({
			databaseUrl: "memory://",
			env: { SHUTDOWN_DRAIN_DELAY_MS: String(drainMs) },
		});

		const sigtermAt = Date.now();
		server.child.kill("SIGTERM");
		await shutdownStarted(server);

		expect(await productionServerConnectResult(server.port)).toBe("connected");
		await productionServerWaitFor({
			what: "new connections refused",
			check: async () =>
				(await productionServerConnectResult(server.port)) === "ECONNREFUSED",
			timeoutMs: 15_000,
		});
		expect(Date.now() - sigtermAt).toBeGreaterThanOrEqual(drainMs - 100);
		// Not the 5 s default.
		expect(Date.now() - sigtermAt).toBeLessThan(4_000);
		expect(await server.exited).toBe(0);
	});

	it("finishes an in-flight sign-in, answers /readyz 503, refuses new connections and exits 0", async () => {
		await using database = await integrationDatabaseCreate();
		await using server = await productionServerStart({
			databaseUrl: database.databaseUrl,
		});

		// The memory issuer's sign-in form needs no domain. Declared after the server, so it is
		// dropped before server.stop, which would otherwise wait for it until its deadline.
		using slow = await slowRequestStart(server.port, {
			body: new URLSearchParams({ who: "dev-admin" }).toString(),
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				origin: server.url,
			},
			path: "/auth/sign-in",
		});

		server.child.kill("SIGTERM");
		await shutdownStarted(server);
		await productionServerWaitFor({
			what: "new connections refused",
			check: async () =>
				(await productionServerConnectResult(server.port)) === "ECONNREFUSED",
		});
		expect(server.child.exitCode).toBeNull();

		const res = await slow.finish();

		expect(res.status).toBe(302);
		expect(res.headers["set-cookie"]?.join("\n")).toContain("__Host-authn=");
		expect(await server.exited).toBe(0);
	});
});
