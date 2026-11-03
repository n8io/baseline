import pg from "pg";
import { afterEach, describe, expect, inject, it } from "vitest";
import { integrationDatabaseCreate } from "./integration-database.ts";
import {
	productionServerStart,
	shutdownStarted,
	signIn,
	slowRequestStart,
} from "./production-server.ts";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

// server-shutdown.test.ts covers the drain itself; this adds that Postgres stays open for it.
describe("server shutdown on SIGTERM with a write in flight", {
	timeout: 30_000,
}, () => {
	it("saves a foo whose POST was in flight and exits 0", async () => {
		const { databaseUrl, drop } = await integrationDatabaseCreate();
		cleanups.push(drop);
		const server = await productionServerStart({
			cacheUrl: inject("integrationCacheUrl"),
			databaseUrl,
		});
		cleanups.push(server.stop);
		const { authorization } = await signIn(server.url);

		const slow = await slowRequestStart(server.port, {
			body: JSON.stringify({ name: "Sent slowly" }),
			headers: { authorization, "content-type": "application/json" },
			path: "/api/v1/foos",
		});
		// Runs before server.stop, which would otherwise wait for this request until its deadline.
		cleanups.push(async () => slow.abort());

		server.child.kill("SIGTERM");
		await shutdownStarted(server);
		expect(server.child.exitCode).toBeNull();

		const res = await slow.finish();

		expect(res.status).toBe(201);
		expect(JSON.parse(res.text)).toMatchObject({ name: "Sent slowly" });
		expect(await server.exited).toBe(0);
		const pgClient = new pg.Client({ connectionString: databaseUrl });
		await pgClient.connect();
		const { rows } = await pgClient.query("SELECT name FROM foo.foo");
		await pgClient.end();
		expect(rows).toEqual([{ name: "Sent slowly" }]);
	});
});
