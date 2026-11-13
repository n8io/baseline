// Started by register.test.ts with telemetry-test-fixtures/preload.ts. Sends one Redis command
// outside any span and one inside a span to a stand-in server, then flushes telemetry and exits.

import type { AddressInfo } from "node:net";
import { createServer } from "node:net";
import { telemetryShutdown } from "@n8io/baseline-telemetry";
import { telemetrySpanRun } from "@n8io/baseline-telemetry/span";
import { createClient } from "redis";

// Answers every command with OK: one reply per RESP array a chunk holds.
const server = createServer((socket) => {
	socket.on("data", (chunk) => {
		const commands = chunk.toString().match(/^\*\d+\r$/gm) ?? [];
		socket.write("+OK\r\n".repeat(commands.length));
	});
});

server.listen(0, "127.0.0.1", async () => {
	const { port } = server.address() as AddressInfo;
	const client = createClient({ url: `redis://127.0.0.1:${port}` });
	await client.connect();
	await client.get("outside");
	await telemetrySpanRun("inside", () => client.get("inside"));
	client.destroy();
	server.close();
	await telemetryShutdown();
});
