import { once } from "node:events";
import { connect, createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { type HealthServer, healthServerCreate } from "./index.ts";

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

const servers: HealthServer[] = [];

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.close()));
});

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
	servers.push(server);
	return { port, server };
};

const ok: Probe = { body: "ok", status: 200 };
const unavailable: Probe = { body: "unavailable", status: 503 };

describe("healthServerCreate", () => {
	it("answers /readyz 503 until ready() is called", async () => {
		const { port, server } = await serverStart({
			alive: true,
			shuttingDown: false,
		});

		expect(await probeGet(port, "/readyz")).toEqual(unavailable);
		server.ready();
		expect(await probeGet(port, "/readyz")).toEqual(ok);
	});

	it("answers /readyz 503 again once shutdown starts", async () => {
		const state = { alive: true, shuttingDown: false };
		const { port, server } = await serverStart(state);
		server.ready();

		expect(await probeGet(port, "/readyz")).toEqual(ok);
		state.shuttingDown = true;
		expect(await probeGet(port, "/readyz")).toEqual(unavailable);
	});

	it("answers /readyz 503 when shutdown starts before ready()", async () => {
		const { port, server } = await serverStart({
			alive: true,
			shuttingDown: true,
		});
		server.ready();

		expect(await probeGet(port, "/readyz")).toEqual(unavailable);
	});

	it("answers /livez from isAlive(), whatever readiness is", async () => {
		const state = { alive: true, shuttingDown: true };
		const { port } = await serverStart(state);

		expect(await probeGet(port, "/livez")).toEqual(ok);
		state.alive = false;
		expect(await probeGet(port, "/livez")).toEqual(unavailable);
	});

	it("ignores a query string on the probe paths", async () => {
		const { port } = await serverStart({ alive: true, shuttingDown: false });

		expect(await probeGet(port, "/livez?verbose")).toEqual(ok);
	});

	it("answers 404 on any other path", async () => {
		const { port } = await serverStart({ alive: true, shuttingDown: false });

		expect((await probeGet(port, "/")).status).toBe(404);
		expect((await probeGet(port, "/healthz")).status).toBe(404);
	});

	it("keeps an idle probe connection open for 65 s", async () => {
		const { port } = await serverStart({ alive: true, shuttingDown: false });
		await probeGet(port, "/livez");

		const response = await fetch(`http://127.0.0.1:${port}/livez`);
		await response.text();

		expect(response.headers.get("keep-alive")).toBe("timeout=65");
	});

	it("close() does not wait for a connection that is open but not idle", async () => {
		const { port, server } = await serverStart({
			alive: true,
			shuttingDown: false,
		});
		await probeGet(port, "/livez");
		// Half a request: the connection is busy until the headers time out.
		const socket = connect(port, "127.0.0.1");
		await once(socket, "connect");
		socket.write("GET /livez HTTP/1.1\r\n");
		await probeGet(port, "/livez");

		const started = performance.now();
		await server.close();
		servers.splice(servers.indexOf(server), 1);
		socket.destroy();

		expect(performance.now() - started).toBeLessThan(1_000);
	});

	it("stops accepting connections after close()", async () => {
		const { port, server } = await serverStart({
			alive: true,
			shuttingDown: false,
		});
		expect(await probeGet(port, "/livez")).toEqual(ok);

		await server.close();
		servers.splice(servers.indexOf(server), 1);

		await expect(fetch(`http://127.0.0.1:${port}/livez`)).rejects.toThrow();
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
});
