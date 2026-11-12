import { once } from "node:events";
import { createServer as netServerCreate } from "node:net";
import { describe, expect, it } from "vitest";
import { productionServerStart } from "./production-server.ts";

describe("production server start", () => {
	it("reports the exit code and the crash log when the server cannot listen", async () => {
		const taken = netServerCreate().listen(0);
		await once(taken, "listening");
		const address = taken.address();
		if (address === null || typeof address === "string") {
			throw new Error("no port");
		}
		try {
			const start = productionServerStart({
				databaseUrl: "memory://",
				env: { PORT: String(address.port) },
			});
			await expect(start).rejects.toThrow(
				/exited before .*: code 1, signal null\nstdout:\n.*EADDRINUSE/s,
			);
		} finally {
			taken.close();
		}
	}, 30_000);
});
