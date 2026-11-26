import { once } from "node:events";
import { connect, createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { healthServerCreate } from "./health-server.ts";

const portFree = (): Promise<number> =>
	new Promise((resolve, reject) => {
		const probe = createServer();
		probe.once("error", reject);
		probe.listen(0, () => {
			const address = probe.address();
			const port = typeof address === "object" && address ? address.port : 0;
			probe.close(() => resolve(port));
		});
	});

type Probe = { status: number; body: string };

// The server listens asynchronously, so retry until the port accepts a connection.
const probeGet = async (port: number, path: string): Promise<Probe> => {
	for (let attempt = 0; ; attempt += 1) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}${path}`);
			return { body: await response.text(), status: response.status };
		} catch (error) {
			if (attempt >= 50) {
				throw error;
			}
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}
};

const serverStart = async (state: {
	alive: boolean;
	shuttingDown: boolean;
}) => {
	const port = await portFree();
	const server = healthServerCreate({
		isAlive: () => state.alive,
		isShuttingDown: () => state.shuttingDown,
		port,
	});
	return Object.assign(server, { port });
};

const ok: Probe = { body: "ok", status: 200 };
const unavailable: Probe = { body: "unavailable", status: 503 };

describe("healthServerCreate", () => {
	it("answers /readyz 503 until ready() is called", async () => {
		await using server = await serverStart({
			alive: true,
			shuttingDown: false,
		});

		expect(await probeGet(server.port, "/readyz")).toEqual(unavailable);
		server.ready();
		expect(await probeGet(server.port, "/readyz")).toEqual(ok);
	});

	it("answers /readyz 503 again once shutdown starts", async () => {
		const state = { alive: true, shuttingDown: false };
		await using server = await serverStart(state);
		server.ready();

		expect(await probeGet(server.port, "/readyz")).toEqual(ok);
		state.shuttingDown = true;
		expect(await probeGet(server.port, "/readyz")).toEqual(unavailable);
	});

	it("answers /readyz 503 when shutdown starts before ready()", async () => {
		await using server = await serverStart({
			alive: true,
			shuttingDown: true,
		});
		server.ready();

		expect(await probeGet(server.port, "/readyz")).toEqual(unavailable);
	});

	it("answers /livez from isAlive(), whatever readiness is", async () => {
		const state = { alive: true, shuttingDown: true };
		await using server = await serverStart(state);

		expect(await probeGet(server.port, "/livez")).toEqual(ok);
		state.alive = false;
		expect(await probeGet(server.port, "/livez")).toEqual(unavailable);
	});

	it("ignores a query string on the probe paths", async () => {
		await using server = await serverStart({
			alive: true,
			shuttingDown: false,
		});

		expect(await probeGet(server.port, "/livez?verbose")).toEqual(ok);
	});

	it("answers 404 on any other path", async () => {
		await using server = await serverStart({
			alive: true,
			shuttingDown: false,
		});

		expect((await probeGet(server.port, "/")).status).toBe(404);
		expect((await probeGet(server.port, "/healthz")).status).toBe(404);
	});

	it("keeps an idle probe connection open for 65 s", async () => {
		await using server = await serverStart({
			alive: true,
			shuttingDown: false,
		});
		await probeGet(server.port, "/livez");

		const response = await fetch(`http://127.0.0.1:${server.port}/livez`);
		await response.text();

		expect(response.headers.get("keep-alive")).toBe("timeout=65");
	});

	it("close() does not wait for a connection that is open but not idle", async () => {
		const server = await serverStart({
			alive: true,
			shuttingDown: false,
		});
		await probeGet(server.port, "/livez");
		// Half a request: the connection is busy until the headers time out.
		const socket = connect(server.port, "127.0.0.1");
		await once(socket, "connect");
		socket.write("GET /livez HTTP/1.1\r\n");
		await probeGet(server.port, "/livez");

		const started = performance.now();
		await server.close();
		socket.destroy();

		expect(performance.now() - started).toBeLessThan(1_000);
	});

	it("stops accepting connections after close()", async () => {
		const server = await serverStart({
			alive: true,
			shuttingDown: false,
		});
		expect(await probeGet(server.port, "/livez")).toEqual(ok);

		await server.close();

		await expect(
			fetch(`http://127.0.0.1:${server.port}/livez`),
		).rejects.toThrow();
	});

	it("await using stops accepting connections when its block ends", async () => {
		const port = await portFree();
		{
			await using _server = healthServerCreate({
				isAlive: () => true,
				isShuttingDown: () => false,
				port,
			});
			expect(await probeGet(port, "/livez")).toEqual(ok);
		}

		await expect(fetch(`http://127.0.0.1:${port}/livez`)).rejects.toThrow();
	});

	it.each([-1, 65_536, 1.5, Number.NaN])(
		"throws a TypeError for port %s",
		(port) => {
			expect(() =>
				healthServerCreate({
					isAlive: () => true,
					isShuttingDown: () => false,
					port,
				}),
			).toThrow(
				new TypeError(
					`healthServerCreate: port must be a whole number from 0 to 65535, found ${port}`,
				),
			);
		},
	);
});
