import pg from "pg";
import { describe, expect, it } from "vitest";
import { integrationDatabaseCreate } from "./integration-database.ts";
import { integrationSignIn } from "./integration-sign-in.ts";
import {
	productionServerStart,
	shutdownStarted,
	slowRequestStart,
} from "./production-server.ts";

// server-shutdown.test.ts covers the drain itself; this adds that Postgres stays open for it.
describe("server shutdown on SIGTERM with a write in flight", {
	timeout: 60_000,
}, () => {
	it("saves a foo whose POST was in flight and exits 0", async () => {
		await using database = await integrationDatabaseCreate();
		const { databaseUrl } = database;
		await using server = await productionServerStart({
			databaseUrl,
		});
		const { authorization } = await integrationSignIn(server.url);

		// Declared after the server, so it is dropped before server.stop, which would otherwise wait
		// for it until its deadline.
		using slow = await slowRequestStart(server.port, {
			body: JSON.stringify({ name: "Sent slowly" }),
			headers: { authorization, "content-type": "application/json" },
			path: "/api/v1/foos",
		});

		server.child.kill("SIGTERM");
		await shutdownStarted(server);
		expect(server.child.exitCode).toBeNull();

		const res = await slow.finish();

		expect(res.status).toBe(201);
		expect(JSON.parse(res.text)).toMatchObject({ name: "Sent slowly" });
		expect(await server.exited).toBe(0);
		const pgClient = new pg.Client({ connectionString: databaseUrl });
		await pgClient.connect();
		try {
			const { rows } = await pgClient.query("SELECT name FROM foo.foo");
			expect(rows).toEqual([{ name: "Sent slowly" }]);
		} finally {
			await pgClient.end();
		}
	});
});
