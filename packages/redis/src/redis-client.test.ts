import { once } from "node:events";
import { createServer, type Socket } from "node:net";
import { describe, expect, it } from "vitest";
import { redisClientCreate } from "./index.ts";

describe("redisClientCreate", () => {
	it.each([
		[{ url: "redis://other" }, "vendor.url is not allowed: it is set by url"],
		[
			{ password: "secret" },
			"vendor.password is not allowed: it is set by url",
		],
		[{ username: "app" }, "vendor.username is not allowed: it is set by url"],
		[{ database: 2 }, "vendor.database is not allowed: it is set by url"],
		[{ socket: { host: "other" } }, "vendor.socket.host is not allowed"],
		[{ socket: { tls: true } }, "vendor.socket.tls is not allowed"],
		[
			{ commandOptions: { timeout: 5_000 } },
			"vendor.commandOptions is not allowed",
		],
		[
			{ socket: { connectTimeout: 10_000 } },
			"vendor.socket.connectTimeout is not allowed",
		],
		[
			{ socket: { reconnectStrategy: false as const } },
			"vendor.socket.reconnectStrategy is not allowed",
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
		).rejects.toThrow("vendor.credentialsProvider is not allowed");
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
});
