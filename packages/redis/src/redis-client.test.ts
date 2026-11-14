import { describe, expect, it } from "vitest";
import { redisClientCreate } from "./index.ts";

describe("redisClientCreate", () => {
	it.each([
		[{ url: "redis://other" }, "vendor.url is not allowed: it is set by url"],
		[
			{ password: "secret" },
			"vendor.password is not allowed: it is set by url",
		],
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
});
