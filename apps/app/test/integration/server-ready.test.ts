import { once } from "node:events";
import { createServer as netServerCreate } from "node:net";
import { describe, expect, it } from "vitest";
import {
	httpStatus,
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
					statuses.add(await httpStatus(server.healthPort, "/readyz"));
					return server.child.exitCode !== null;
				},
			});

			expect(await server.exited).toBe(1);
			expect(statuses).not.toContain(200);
			expect(server.stdout()).toContain("EADDRINUSE");
			expect(server.stdout()).not.toContain(readyLog);
		} finally {
			taken.close();
		}
	});
});
