import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { it as base, expect } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

// A real local API that records the traceparent of each request it gets.
const apiStart = async () => {
	const headers: (string | undefined)[] = [];
	const server = createServer((request, response) => {
		headers.push(request.headers["traceparent"] as string | undefined);
		response.writeHead(204).end();
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return {
		baseUrl: `http://127.0.0.1:${port}`,
		headers,
		server,
	};
};

// Starts the fixture as a child process and resolves once it prints its ready line. Loading
// TypeScript and the telemetry SDK in a new process is slow on a cold or busy machine, so that
// wait is part of this setup and the test itself only measures the request.
const childStart = async (baseUrl: string) => {
	const child = spawn(
		process.execPath,
		[
			"--import",
			"@n8io/baseline-telemetry/register",
			"src/sdk-test-fixtures/traceparent.ts",
			baseUrl,
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
			stdio: ["pipe", "pipe", "inherit"],
		},
	);
	const exited = new Promise<number | null>((resolve) => {
		child.on("close", resolve);
	});
	const lines = createInterface({ input: child.stdout })[
		Symbol.asyncIterator
	]();
	const first = await Promise.race([
		lines.next(),
		exited.then(() => ({ done: true, value: undefined })),
	]);
	if (first.value !== "ready") {
		throw new Error("The traceparent fixture exited before it was ready");
	}
	return { child, exited };
};

// The API and the ready child are set up once per file, outside the test's own timeout.
const it = base.extend<{ started: Awaited<ReturnType<typeof setup>> }>({
	started: [
		// biome-ignore lint/correctness/noEmptyPattern: Vitest requires a destructured first argument
		async ({}, use) => {
			const started = await setup();
			await use(started);
			// Stops the child with the test, so a failure never leaves it calling a closed server.
			started.child.kill();
			await new Promise<void>((resolve) => {
				started.server.close(() => resolve());
			});
		},
		{ scope: "file" },
	],
});

const setup = async () => {
	const api = await apiStart();
	const { child, exited } = await childStart(api.baseUrl);
	return { ...api, child, exited };
};

// The SDK has no trace code: telemetry's fetch instrumentation adds the header. This proves it
// does for a call made through sdkFetch inside a span.
it("sends traceparent when telemetry is started and a span is active", async ({
	started,
}) => {
	started.child.stdin.end("go\n");

	const code = await started.exited;

	expect(code).toBe(0);
	expect(started.headers).toHaveLength(1);
	expect(started.headers[0]).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
});
