// Started by register.test.ts with telemetry-test-fixtures/preload.ts. Serves one
// request with a query, one health probe, then flushes telemetry and exits.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { telemetryShutdown } from "@n8io/baseline-telemetry";

const server = createServer((_request, response) => {
	response.end("ok");
});

server.listen(0, "127.0.0.1", async () => {
	const { port } = server.address() as AddressInfo;
	await (await fetch(`http://127.0.0.1:${port}/foos?name=canary`)).text();
	await (await fetch(`http://127.0.0.1:${port}/livez`)).text();
	server.close();
	await telemetryShutdown();
});
