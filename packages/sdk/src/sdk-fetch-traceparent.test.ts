import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { beforeAll, expect, it } from "vitest";

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

const setup = async () => {
	const api = await apiStart();
	const { child, exited } = await childStart(api.baseUrl);
	return { ...api, child, exited };
};

// Vitest counts a file-scoped fixture's setup inside the first test's timeout, so the child's cold
// start has to run in beforeAll, which has its own hook timeout. The test then waits on the
// started child and measures only the request.
const started = Promise.withResolvers<Awaited<ReturnType<typeof setup>>>();

beforeAll(async () => {
	const running = await setup().catch((error: unknown) => {
		started.reject(error);
		throw error;
	});
	started.resolve(running);
	// Stops the child after the test, so a failure never leaves it calling a closed server.
	return async () => {
		running.child.kill();
		await new Promise<void>((resolve) => {
			running.server.close(() => resolve());
		});
	};
}, 60_000);

// The SDK has no trace code: telemetry's fetch instrumentation adds the header. This proves it
// does for a call made through sdkFetch inside a span.
it("sends traceparent when telemetry is started and a span is active", async () => {
	const running = await started.promise;
	running.child.stdin.end("go\n");

	const code = await running.exited;

	expect(code).toBe(0);
	expect(running.headers).toHaveLength(1);
	expect(running.headers[0]).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
});
