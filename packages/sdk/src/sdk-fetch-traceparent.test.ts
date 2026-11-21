import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

// The SDK has no trace code: telemetry's fetch instrumentation adds the header. This proves it
// does for a call made through sdkFetch inside a span.
it("sends traceparent when telemetry is started and a span is active", async () => {
	const headers: (string | undefined)[] = [];
	const server = createServer((request, response) => {
		headers.push(request.headers["traceparent"] as string | undefined);
		response.writeHead(204).end();
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	await using _closed = {
		[Symbol.asyncDispose]: () =>
			new Promise<void>((resolve) => server.close(() => resolve())),
	};
	const { port } = server.address() as AddressInfo;

	const code = await new Promise<number | null>((resolve) => {
		const child = spawn(
			process.execPath,
			[
				"--import",
				"@n8io/baseline-telemetry/register",
				"src/sdk-test-fixtures/traceparent.ts",
				`http://127.0.0.1:${port}`,
			],
			{
				cwd: packageRoot,
				env: {
					OTEL_LOGS_EXPORTER: "none",
					OTEL_METRICS_EXPORTER: "none",
					// With no trace exporter telemetry starts no tracer, so nothing is traced.
					OTEL_TRACES_EXPORTER: "console",
					PATH: process.env["PATH"] ?? "",
				},
				stdio: ["ignore", "ignore", "inherit"],
			},
		);
		child.on("close", resolve);
	});

	expect(code).toBe(0);
	expect(headers).toHaveLength(1);
	expect(headers[0]).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
});
