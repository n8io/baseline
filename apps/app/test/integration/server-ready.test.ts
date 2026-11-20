import { once } from "node:events";
import { createServer as netServerCreate, type Socket } from "node:net";
import { describe, expect, it } from "vitest";
import {
	productionServerBootMs,
	productionServerHttpStatus,
	productionServerSpawn,
	productionServerStart,
	productionServerWaitFor,
} from "./production-server.ts";

const readyLog = "Server listening and ready";

describe("server readiness", { timeout: 60_000 }, () => {
	it("reports ready once PORT is bound, with no deprecation warning and a 65 s keep-alive", async () => {
		await using server = await productionServerStart({
			databaseUrl: "memory://",
			env: { LOG_LEVEL: "info" },
		});
		await productionServerWaitFor({
			what: "the ready log",
			check: () => server.stdout().includes(readyLog),
		});
		expect(server.stdout()).toContain(readyLog);
		expect(server.stderr()).not.toContain("DeprecationWarning");
		// Idle connections outlast a load balancer's 60 s: Node announces server.keepAliveTimeout.
		const response = await fetch(`${server.url}/auth/sign-in`);
		await response.body?.cancel();
		expect(response.headers.get("keep-alive")).toBe("timeout=65");
	});

	it("never answers /readyz 200 and exits 1 when PORT is taken", async () => {
		const taken = netServerCreate().listen(0);
		await once(taken, "listening");
		const address = taken.address();
		if (address === null || typeof address === "string") {
			throw new Error("no port");
		}
		try {
			await using server = await productionServerSpawn({
				databaseUrl: "memory://",
				env: { LOG_LEVEL: "info", PORT: String(address.port) },
			});
			const statuses = new Set<number | undefined>();
			await productionServerWaitFor({
				what: "the exit",
				check: async () => {
					statuses.add(
						await productionServerHttpStatus(server.healthPort, "/readyz"),
					);
					return server.child.exitCode !== null;
				},
				// The boot itself must fail, so the exit comes after a whole boot.
				timeoutMs: productionServerBootMs,
			});

			expect(await server.exited).toBe(1);
			expect(statuses).not.toContain(200);
			expect(server.stdout()).toContain("EADDRINUSE");
			expect(server.stdout()).not.toContain(readyLog);
		} finally {
			taken.close();
		}
	});

	it("never answers /readyz 200 and exits 1 while Postgres is unreachable", async () => {
		await using server = await productionServerSpawn({
			// Nothing listens on port 1.
			databaseUrl: "postgres://baseline:baseline@127.0.0.1:1/baseline",
			env: { LOG_LEVEL: "info" },
		});
		const statuses = new Set<number | undefined>();
		await productionServerWaitFor({
			what: "the exit",
			check: async () => {
				statuses.add(
					await productionServerHttpStatus(server.healthPort, "/readyz"),
				);
				return server.child.exitCode !== null;
			},
			timeoutMs: 30_000,
		});

		expect(await server.exited).toBe(1);
		expect(statuses).not.toContain(200);
		// One structured fatal line, not a raw pg-pool stack on stderr.
		expect(server.stdout()).toContain("Boot failed: a connection did not open");
		expect(server.stdout()).toContain("ECONNREFUSED");
		expect(server.stderr()).not.toContain("    at ");
		expect(server.stdout()).not.toContain(readyLog);
	});

	it("keeps the health port closed while Postgres accepts connections and never answers", async () => {
		// A refused connection fails the boot within milliseconds; a silent Postgres holds it at
		// the startup check, which is where a startup probe on /livez must still get no answer.
		const sockets = new Set<Socket>();
		const silent = netServerCreate((socket) => {
			sockets.add(socket);
		}).listen(0);
		await once(silent, "listening");
		const address = silent.address();
		if (address === null || typeof address === "string") {
			throw new Error("no port");
		}
		try {
			await using server = await productionServerSpawn({
				databaseUrl: `postgres://baseline:baseline@127.0.0.1:${address.port}/baseline`,
				env: { LOG_LEVEL: "info" },
			});
			const statuses = new Set<number | undefined>();
			const until = Date.now() + 1_500;
			await productionServerWaitFor({
				what: "one and a half seconds without an answer",
				check: async () => {
					statuses.add(
						await productionServerHttpStatus(server.healthPort, "/livez"),
					);
					statuses.add(
						await productionServerHttpStatus(server.healthPort, "/readyz"),
					);
					return Date.now() > until;
				},
			});

			expect(statuses).toEqual(new Set([undefined]));
			expect(server.child.exitCode).toBeNull();
		} finally {
			for (const socket of sockets) socket.destroy();
			silent.close();
		}
	});
});
