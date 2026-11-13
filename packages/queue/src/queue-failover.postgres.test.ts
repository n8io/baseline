import { createServer, connect as netConnect, type Socket } from "node:net";
import { setTimeout } from "node:timers/promises";
import { logger } from "@n8io/baseline-logger";
import { type PostgresPool, postgresPoolCreate } from "@n8io/baseline-postgres";
import { ok } from "@n8io/baseline-result";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { postgresTestDatabaseCreate } from "../../../test/postgres/postgres-test-database.ts";
import {
	type Queue,
	queueConsumerCreate,
	queueCreate,
	queueEventsCreate,
	queueMigrate,
} from "./index.ts";
import { queueBossGet } from "./queue.ts";

// A TCP proxy in front of the test Postgres that can play a failover for this file alone: while
// frozen, open connections go silent without closing (a primary that died) and new ones are
// accepted but never answered. Unfreezing drops them all, so the next connect reaches Postgres.
const proxyStart = async (target: URL) => {
	let frozen = false;
	const sockets = new Set<Socket>();
	const server = createServer((client) => {
		sockets.add(client);
		client.on("error", () => undefined);
		client.on("close", () => sockets.delete(client));
		if (frozen) {
			return;
		}
		const upstream = netConnect(Number(target.port), target.hostname);
		sockets.add(upstream);
		upstream.on("error", () => client.destroy());
		upstream.on("close", () => {
			sockets.delete(upstream);
			client.destroy();
		});
		client.on("close", () => upstream.destroy());
		client.pipe(upstream);
		upstream.pipe(client);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (address === null || typeof address === "string") {
		throw new Error("no port");
	}
	const url = new URL(target);
	url.hostname = "127.0.0.1";
	url.port = String(address.port);
	return {
		close: async () => {
			for (const socket of sockets) socket.destroy();
			await new Promise((resolve) => server.close(resolve));
		},
		freeze: () => {
			frozen = true;
			for (const socket of sockets) {
				socket.unpipe();
				socket.pause();
			}
		},
		unfreeze: () => {
			frozen = false;
			for (const socket of sockets) socket.destroy();
		},
		url: url.toString(),
	};
};

let proxy: Awaited<ReturnType<typeof proxyStart>>;
let pgPool: PostgresPool;
let queue: Queue;

beforeAll(async () => {
	const databaseUrl = await postgresTestDatabaseCreate();
	await queueMigrate({ databaseUrl });
	proxy = await proxyStart(new URL(databaseUrl));
	// The Template's Worker pool, with shorter timeouts so each poll fails within the test.
	pgPool = postgresPoolCreate({
		connectTimeoutMs: 1_000,
		databaseUrl: proxy.url,
		max: 5,
		queryTimeoutMs: 2_000,
	});
	queue = await queueCreate({ pgPool, role: "worker" });
});

afterAll(async () => {
	await queue.stop();
	await pgPool.end();
	await proxy.close();
});

describe("a Postgres failover longer than the liveness window", () => {
	it("keeps the worker alive while its polls fail, and Events flow again after it with no restart", {
		timeout: 150_000,
	}, async () => {
		vi.spyOn(logger, "error").mockReturnValue(undefined);
		const boss = queueBossGet(queue);
		const handled: string[] = [];
		await queueEventsCreate(queue).consumersStart([
			queueConsumerCreate({
				eventName: "foo.created",
				queueName: "search.foo-created",
				run: async (event) => {
					handled.push(event.fooId);
					return ok(undefined);
				},
				schema: z.object({ fooId: z.string() }),
			}),
		]);
		const send = (fooId: string) =>
			boss.send(
				"search.foo-created.ordered",
				{ fooId },
				{ singletonKey: fooId },
			);
		await send("foo_before");
		await vi.waitFor(() => expect(handled).toEqual(["foo_before"]), {
			interval: 100,
			timeout: 10_000,
		});
		const stamps = (key: "lastErrorOn" | "lastFetchedOn"): number =>
			Math.max(...boss.getWipData().map((wip) => wip[key] ?? 0));

		proxy.freeze();
		const frozenAt = Date.now();
		const alive = new Set<boolean>();
		while (Date.now() - frozenAt < 65_000) {
			alive.add(queue.isAlive());
			await setTimeout(1_000);
		}

		// No poll has completed for longer than the window, and polls are still failing.
		expect(Date.now() - stamps("lastFetchedOn")).toBeGreaterThan(60_000);
		expect(Date.now() - stamps("lastErrorOn")).toBeLessThan(20_000);
		expect([...alive]).toEqual([true]);
		expect(queue.isAlive()).toBe(true);

		proxy.unfreeze();
		await vi.waitFor(async () => expect(await send("foo_after")).toBeTruthy(), {
			interval: 500,
			timeout: 20_000,
		});
		await vi.waitFor(
			() => expect(handled).toEqual(["foo_before", "foo_after"]),
			{ interval: 100, timeout: 30_000 },
		);
		expect(queue.isAlive()).toBe(true);
	});
});
