import { once } from "node:events";
import { createServer, type Socket } from "node:net";
import { describe, expect, it } from "vitest";
import { type RedisClient, redisClientCreate } from "./index.ts";
import { redisLoggerTestRecord } from "./redis-logger-test-record.ts";

// The state node-redis keeps, which the Package's RedisClient type leaves out on purpose.
const nodeStateOf = (client: RedisClient) =>
	client as unknown as { isOpen: boolean; isReady: boolean };

// A fake Redis on a local port: it answers every command with +OK and records each one, so the
// tests see what the client sends and how it reconnects without a real server.
const redisFake = async ({
	closeAfterFirst = false,
}: {
	closeAfterFirst?: boolean;
} = {}) => {
	const commands: string[][] = [];
	const sockets: Socket[] = [];
	const connectedAt: number[] = [];
	const server = createServer((socket) => {
		sockets.push(socket);
		connectedAt.push(Date.now());
		let buffer = "";
		socket.on("error", () => undefined);
		socket.on("data", (chunk) => {
			buffer += chunk.toString();
			for (;;) {
				const match = /^\*(\d+)\r\n/.exec(buffer);
				if (!match) return;
				const parts: string[] = [];
				let rest = buffer.slice(match[0].length);
				for (let index = 0; index < Number(match[1]); index++) {
					const bulk = /^\$(\d+)\r\n/.exec(rest);
					if (!bulk) return;
					const start = bulk[0].length;
					const end = start + Number(bulk[1]);
					if (rest.length < end + 2) return;
					parts.push(rest.slice(start, end));
					rest = rest.slice(end + 2);
				}
				buffer = rest;
				commands.push(parts);
				socket.write("+OK\r\n");
			}
		});
		if (closeAfterFirst && connectedAt.length > 1) socket.destroy();
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (address === null || typeof address === "string") throw new Error();
	return {
		close: async (): Promise<void> => {
			for (const socket of sockets) socket.destroy();
			server.close();
			await once(server, "close");
		},
		commands,
		connectedAt,
		dropAll: (): void => {
			for (const socket of sockets) socket.resetAndDestroy();
		},
		sockets,
		url: `redis://127.0.0.1:${address.port}`,
	};
};

describe("redisClientCreate", () => {
	it("rejects a url that does not parse", async () => {
		await expect(redisClientCreate({ url: "not a url" })).rejects.toThrow(
			new TypeError("redisClientCreate: url is not a valid URL"),
		);
	});

	it("rejects a url with another scheme, without echoing the url", async () => {
		await expect(
			redisClientCreate({ url: "http://user:secret@127.0.0.1:1" }),
		).rejects.toThrow(
			new TypeError(
				'redisClientCreate: url must start with redis:// or rediss://, found "http://"',
			),
		);
	});

	it.each([
		[
			{ url: "redis://other" },
			"redisClientCreate: vendor.url is not allowed: it is set by url",
		],
		[
			{ password: "secret" },
			"redisClientCreate: vendor.password is not allowed: it is set by url",
		],
		[
			{ username: "app" },
			"redisClientCreate: vendor.username is not allowed: it is set by url",
		],
		[
			{ database: 2 },
			"redisClientCreate: vendor.database is not allowed: it is set by url",
		],
		[
			{ socket: { host: "other" } },
			"redisClientCreate: vendor.socket.host is not allowed",
		],
		[
			{ socket: { tls: true } },
			"redisClientCreate: vendor.socket.tls is not allowed",
		],
		[
			{ commandOptions: { timeout: 5_000 } },
			"redisClientCreate: vendor.commandOptions is not allowed",
		],
		[
			{ socket: { connectTimeout: 10_000 } },
			"redisClientCreate: vendor.socket.connectTimeout is not allowed",
		],
		[
			{ socket: { reconnectStrategy: false as const } },
			"redisClientCreate: vendor.socket.reconnectStrategy is not allowed",
		],
	])(
		"refuses a vendor setting it decides itself: %o",
		async (vendor, message) => {
			await expect(
				redisClientCreate({
					url: "redis://127.0.0.1:1",
					// Each is refused at run time; the type already leaves some of them out.
					vendor: vendor as never,
				}),
			).rejects.toThrow(message);
		},
	);

	it("refuses a credentialsProvider when the url carries a password", async () => {
		await expect(
			redisClientCreate({
				url: "redis://:secret@127.0.0.1:1",
				vendor: {
					credentialsProvider: {
						credentials: async () => ({ password: "other" }),
						type: "async-credentials-provider",
					},
				},
			}),
		).rejects.toThrow(
			"redisClientCreate: vendor.credentialsProvider is not allowed",
		);
	});

	it("rejects within 3 s when the server accepts and never answers", async () => {
		const sockets: Socket[] = [];
		const server = createServer((socket) => sockets.push(socket));
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		const address = server.address();
		if (address === null || typeof address === "string") throw new Error();
		try {
			const started = Date.now();
			await expect(
				redisClientCreate({ url: `redis://127.0.0.1:${address.port}` }),
			).rejects.toThrow("Redis not ready within 3000 ms");
			expect(Date.now() - started).toBeLessThan(4_000);
		} finally {
			for (const socket of sockets) socket.destroy();
			server.close();
		}
	});

	it("connects, passes the vendor settings on, and closes with await using", async () => {
		const fake = await redisFake();
		try {
			{
				await using redisClient = await redisClientCreate({
					url: fake.url,
					vendor: { name: "baseline-test" },
				});
				expect(nodeStateOf(redisClient).isOpen).toBe(true);
				expect(fake.commands).toContainEqual([
					"HELLO",
					"3",
					"SETNAME",
					"baseline-test",
				]);
			}
			const [socket] = fake.sockets;
			await expect.poll(() => socket?.destroyed).toBe(true);
		} finally {
			await fake.close();
		}
	});

	it("rejects at once with the socket error when nothing listens, instead of retrying", async () => {
		using _errors = redisLoggerTestRecord("error");
		const fake = await redisFake();
		const { url } = fake;
		await fake.close();
		const started = Date.now();

		await expect(redisClientCreate({ url })).rejects.toThrow(/ECONNREFUSED/);
		expect(Date.now() - started).toBeLessThan(1_000);
	});

	it("closes the socket it opened when the server never answers", async () => {
		const sockets: Socket[] = [];
		const server = createServer((socket) => {
			// Reading keeps the socket flowing, so it sees the client close.
			socket.resume();
			sockets.push(socket);
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		const address = server.address();
		if (address === null || typeof address === "string") throw new Error();
		try {
			await expect(
				redisClientCreate({ url: `redis://127.0.0.1:${address.port}` }),
			).rejects.toThrow("Redis not ready within 3000 ms");
			const [socket] = sockets;
			await expect.poll(() => socket?.destroyed).toBe(true);
		} finally {
			for (const socket of sockets) socket.destroy();
			server.close();
		}
	});

	it("logs a client error without the url, and reconnects after a drop", async () => {
		using errors = redisLoggerTestRecord("error");
		const fake = await redisFake();
		const redisClient = await redisClientCreate({ url: fake.url });
		try {
			fake.dropAll();

			await expect.poll(() => fake.connectedAt).toHaveLength(2);
			expect(errors.calls[0]?.[1]).toBe("Redis client error");
			expect(errors.calls[0]?.[0]).toEqual({ err: expect.any(Error) });
		} finally {
			redisClient.destroy();
			await fake.close();
		}
	});

	it("waits longer between each reconnect, up to the cap", async () => {
		using _errors = redisLoggerTestRecord("error");
		const fake = await redisFake({ closeAfterFirst: true });
		const redisClient = await redisClientCreate({ url: fake.url });
		try {
			fake.dropAll();

			await expect
				.poll(() => fake.connectedAt.length, { timeout: 3_000 })
				.toBeGreaterThan(3);
			const gaps = fake.connectedAt
				.slice(1)
				.map((at, index) => at - (fake.connectedAt[index] ?? at));
			expect(gaps[2]).toBeGreaterThanOrEqual(150);
			expect(gaps[1]).toBeGreaterThanOrEqual(50);
		} finally {
			// Not close(): that waits on a server that keeps dropping the connection.
			redisClient.destroy();
			await fake.close();
		}
	});

	it("rejects a command within 1 s while the connection is down", async () => {
		using _errors = redisLoggerTestRecord("error");
		const fake = await redisFake();
		await using redisClient = await redisClientCreate({ url: fake.url });
		await fake.close();
		await expect.poll(() => nodeStateOf(redisClient).isReady).toBe(false);

		const started = Date.now();
		await expect(redisClient.get("key")).rejects.toThrow();
		expect(Date.now() - started).toBeLessThan(2_000);
	});

	it("accepts a rediss:// url", async () => {
		using _errors = redisLoggerTestRecord("error");
		const fake = await redisFake();
		const { url } = fake;
		await fake.close();

		await expect(
			redisClientCreate({ url: url.replace("redis:", "rediss:") }),
		).rejects.toThrow(/ECONNREFUSED/);
	});

	it("accepts a credentialsProvider when the url carries no user or password", async () => {
		const fake = await redisFake();
		try {
			await using redisClient = await redisClientCreate({
				url: fake.url,
				vendor: {
					credentialsProvider: {
						credentials: async () => ({ password: "other" }),
						type: "async-credentials-provider",
					},
				},
			});
			expect(nodeStateOf(redisClient).isOpen).toBe(true);
		} finally {
			await fake.close();
		}
	});
});
