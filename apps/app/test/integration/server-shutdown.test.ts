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
	it("finishes an in-flight sign-in, answers /readyz 503, refuses new connections and exits 0", async () => {
		await using database = await integrationDatabaseCreate();
		await using server = await productionServerStart({
			databaseUrl: database.databaseUrl,
		});

		// The memory issuer's sign-in form needs no domain. Declared after the server, so it is
		// dropped before server.stop, which would otherwise wait for it until its deadline.
		using slow = await slowRequestStart(server.port, {
			body: new URLSearchParams({ who: "admin" }).toString(),
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
