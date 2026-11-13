import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { httpServerClose, httpServerKeepAlive } from "./index.ts";

describe("httpServerKeepAlive", () => {
	it("keeps idle connections for 65 s and gives headers longer", () => {
		const server = createServer();

		httpServerKeepAlive(server);

		expect(server.keepAliveTimeout).toBe(65_000);
		expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout);
	});

	it("tells the client the timeout, and close still drops the idle connection at once", async () => {
		const server = createServer((_request, response) => response.end("ok"));
		httpServerKeepAlive(server);
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const { port } = server.address() as AddressInfo;

		// fetch keeps the connection open and idle after the response.
		const response = await fetch(`http://127.0.0.1:${port}/`);
		await response.text();
		const started = performance.now();
		await httpServerClose(server);

		expect(response.headers.get("keep-alive")).toBe("timeout=65");
		expect(performance.now() - started).toBeLessThan(1_000);
	});
});
