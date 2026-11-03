import { once } from "node:events";
import { request } from "node:http";
import { connect } from "node:net";
import pg from "pg";
import { afterEach, describe, expect, inject, it } from "vitest";
import { integrationDatabaseCreate } from "./integration-database.ts";
import { productionServerStart, signIn, waitFor } from "./production-server.ts";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const httpStatus = async (port: number, path: string) => {
	const res = await fetch(`http://127.0.0.1:${port}${path}`).catch(
		() => undefined,
	);
	await res?.body?.cancel();
	return res?.status;
};

// Resolves with the error code of a new TCP connection, or "connected".
const connectResult = (port: number): Promise<string> =>
	new Promise((resolve) => {
		const socket = connect(port, "127.0.0.1");
		socket.once("connect", () => {
			socket.destroy();
			resolve("connected");
		});
		socket.once("error", (error: NodeJS.ErrnoException) =>
			resolve(error.code ?? "error"),
		);
	});

describe("server shutdown on SIGTERM", { timeout: 30_000 }, () => {
	it("finishes an in-flight POST, answers /readyz 503, refuses new connections and exits 0", async () => {
		const { databaseUrl, drop } = await integrationDatabaseCreate();
		cleanups.push(drop);
		const server = await productionServerStart({
			cacheUrl: inject("integrationCacheUrl"),
			databaseUrl,
		});
		cleanups.push(server.stop);
		const { authorization } = await signIn(server.url);
		const body = JSON.stringify({ name: "Sent slowly" });

		// Expect: 100-continue makes the server say when it has the request, so the test knows
		// the request is in flight before it sends SIGTERM.
		const slow = request({
			headers: {
				authorization,
				"content-length": Buffer.byteLength(body),
				"content-type": "application/json",
				expect: "100-continue",
			},
			host: "127.0.0.1",
			method: "POST",
			path: "/api/v1/foos",
			port: server.port,
		});
		const responded = once(slow, "response");
		await once(slow, "continue");
		slow.write(body.slice(0, 5));

		server.child.kill("SIGTERM");
		await waitFor(
			"/readyz 503",
			async () => (await httpStatus(server.healthPort, "/readyz")) === 503,
		);
		await waitFor(
			"new connections refused",
			async () => (await connectResult(server.port)) === "ECONNREFUSED",
		);
		expect(server.child.exitCode).toBeNull();

		slow.end(body.slice(5));
		const [res] = (await responded) as [import("node:http").IncomingMessage];
		let text = "";
		for await (const chunk of res) text += chunk;

		expect(res.statusCode).toBe(201);
		expect(JSON.parse(text)).toMatchObject({ name: "Sent slowly" });
		expect(await server.exited).toBe(0);
		const pgClient = new pg.Client({ connectionString: databaseUrl });
		await pgClient.connect();
		const { rows } = await pgClient.query("SELECT name FROM foo.foo");
		await pgClient.end();
		expect(rows).toEqual([{ name: "Sent slowly" }]);
	});
});
