import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import protobuf from "protobufjs";
import { afterEach, describe, expect, it } from "vitest";

type OtlpSpan = {
	attributes: { key: string; value: { stringValue?: string } }[];
	kind: number;
	name: string;
};

type OtlpTraces = {
	resourceSpans: { scopeSpans: { spans: OtlpSpan[] }[] }[];
};

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const spanKindServer = 2;
const spanKindClient = 3;

// The OTLP span fields the tests read; decoding skips every other field.
const tracesData = protobuf
	.parse(`
syntax = "proto3";
message AnyValue { string string_value = 1; }
message KeyValue { string key = 1; AnyValue value = 2; }
message Span { string name = 5; int32 kind = 6; repeated KeyValue attributes = 9; }
message ScopeSpans { repeated Span spans = 2; }
message ResourceSpans { repeated ScopeSpans scope_spans = 2; }
message TracesData { repeated ResourceSpans resource_spans = 1; }
`)
	.root.lookupType("TracesData");

// A small OTLP/HTTP protobuf receiver that keeps every span and log body it is sent.
const receiverStart = async (): Promise<{
	logs: string[];
	server: Server;
	spans: OtlpSpan[];
}> => {
	const logs: string[] = [];
	const spans: OtlpSpan[] = [];
	const server = createServer(async (request, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) {
			chunks.push(chunk);
		}
		const body = Buffer.concat(chunks);
		if (request.url === "/v1/logs") {
			// Protobuf keeps strings as raw bytes.
			logs.push(body.toString("latin1"));
		}
		if (request.url === "/v1/traces") {
			const traces = tracesData.toObject(tracesData.decode(body), {
				arrays: true,
			}) as OtlpTraces;
			for (const resource of traces.resourceSpans) {
				for (const scope of resource.scopeSpans) {
					spans.push(...scope.spans);
				}
			}
		}
		response.writeHead(200, { "content-type": "application/x-protobuf" }).end();
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return { logs, server, spans };
};

const fixtureRun = (
	env: Record<string, string>,
	fixture = "src/telemetry-test-fixtures/server.ts",
): Promise<{ code: number | null; stderr: string; stdout: string }> =>
	new Promise((resolve) => {
		const child = spawn(
			process.execPath,
			["--import", "./src/telemetry-test-fixtures/preload.ts", fixture],
			{
				cwd: packageRoot,
				env: {
					OTEL_BSP_SCHEDULE_DELAY: "50",
					OTEL_LOGS_EXPORTER: "none",
					OTEL_METRICS_EXPORTER: "none",
					OTEL_SERVICE_NAME: "register-test",
					PATH: process.env.PATH ?? "",
					...env,
				},
			},
		);
		let stderr = "";
		let stdout = "";
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on("close", (code) => resolve({ code, stderr, stdout }));
	});

const attribute = (span: OtlpSpan, key: string): string | undefined =>
	span.attributes.find((item) => item.key === key)?.value.stringValue;

let receiver: Server | undefined;

afterEach(() => {
	receiver?.close();
	receiver = undefined;
});

describe("@n8io/baseline-telemetry/register", () => {
	it("exports http server spans from a native TS process", async () => {
		const started = await receiverStart();
		receiver = started.server;
		const { port } = started.server.address() as AddressInfo;
		const { code, stderr } = await fixtureRun({
			OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
		});
		expect(code).toBe(0);
		expect(stderr).not.toContain("Telemetry:");
		const servers = started.spans.filter(
			(span) => span.kind === spanKindServer,
		);
		expect(servers.map((span) => attribute(span, "url.path"))).toEqual([
			"/foos",
		]);
		expect(attribute(servers[0] as OtlpSpan, "url.query")).toBe(
			"name=REDACTED",
		);
		const clients = started.spans.filter(
			(span) => span.kind === spanKindClient,
		);
		expect(clients.map((span) => attribute(span, "url.full"))).toContainEqual(
			expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/foos\?name=REDACTED$/),
		);
		expect(JSON.stringify(started.spans)).not.toContain("canary");
	}, 30_000);

	it("makes a Redis span for a command inside a span, and none outside one", async () => {
		const started = await receiverStart();
		receiver = started.server;
		const { port } = started.server.address() as AddressInfo;
		const { code } = await fixtureRun(
			{ OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}` },
			"src/telemetry-test-fixtures/redis.ts",
		);
		expect(code).toBe(0);
		// redis-connect is the one span the instrumentation makes with no parent.
		const commands = started.spans.filter(
			(span) => span.name.startsWith("redis-") && span.name !== "redis-connect",
		);
		expect(commands.map((span) => attribute(span, "db.query.text"))).toEqual([
			"GET inside",
		]);
	}, 30_000);

	it("exports records from a logger the app creates after the preload", async () => {
		const started = await receiverStart();
		receiver = started.server;
		const { port } = started.server.address() as AddressInfo;
		const { code } = await fixtureRun(
			{
				OTEL_BLRP_SCHEDULE_DELAY: "50",
				OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
				OTEL_LOGS_EXPORTER: "otlp",
				OTEL_TRACES_EXPORTER: "none",
			},
			"src/telemetry-test-fixtures/logger.ts",
		);
		expect(code).toBe(0);
		expect(started.logs.join("\n")).toContain("fixture record");
	}, 30_000);

	it("warns once and still exports http/protobuf when another protocol is set", async () => {
		const started = await receiverStart();
		receiver = started.server;
		const { port } = started.server.address() as AddressInfo;
		const { code, stderr } = await fixtureRun({
			OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
			OTEL_EXPORTER_OTLP_PROTOCOL: "grpc",
			OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: "http/json",
		});
		expect(code).toBe(0);
		expect(stderr.match(/http\/protobuf only/g)).toHaveLength(1);
		expect(stderr).toContain(
			"OTEL_EXPORTER_OTLP_PROTOCOL, OTEL_EXPORTER_OTLP_TRACES_PROTOCOL ignored",
		);
		expect(started.spans.length).toBeGreaterThan(0);
	}, 30_000);

	it("warns once, and nothing else, when no collector runs", async () => {
		const { code, stderr } = await fixtureRun({
			OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:9",
		});
		expect(code).toBe(0);
		// Only Node's own experimental warnings may print; no deprecation (DEP0205
		// was module.register(), which the preload no longer uses).
		const lines = stderr
			.split("\n")
			.filter(
				(line) =>
					line !== "" &&
					!/ExperimentalWarning|^--import|--trace-warnings/.test(line),
			);
		expect(lines).toEqual([
			expect.stringMatching(/Warning: Telemetry: the final export to/),
		]);
	}, 30_000);

	it("exports nothing, and shuts down at once, when no OTLP endpoint is set", async () => {
		const { code, stdout } = await new Promise<{
			code: number | null;
			stdout: string;
		}>((resolve) => {
			const child = spawn(
				process.execPath,
				[
					"--import",
					"./src/telemetry-test-fixtures/preload.ts",
					"src/telemetry-test-fixtures/shutdown-time.ts",
				],
				{ cwd: packageRoot, env: { PATH: process.env.PATH ?? "" } },
			);
			let out = "";
			child.stdout.on("data", (chunk: Buffer) => {
				out += chunk.toString();
			});
			child.on("close", (exit) => resolve({ code: exit, stdout: out }));
		});
		// The logger may write its record after the fixture prints the time.
		const [elapsed] = stdout.split("\n").filter((line) => /^\d+$/.test(line));
		expect(code).toBe(0);
		expect(elapsed).toBeDefined();
		expect(Number(elapsed)).toBeLessThan(500);
	}, 30_000);

	it("shuts down within the limit and warns once when the collector is unreachable", async () => {
		// A port that was free a moment ago and has nothing listening.
		const closed = createServer();
		await new Promise<void>((resolve) =>
			closed.listen(0, "127.0.0.1", resolve),
		);
		const { port } = closed.address() as AddressInfo;
		await new Promise((resolve) => closed.close(resolve));
		const endpoint = `http://127.0.0.1:${port}`;
		const startedAt = performance.now();
		const { code, stderr, stdout } = await fixtureRun(
			{ OTEL_EXPORTER_OTLP_ENDPOINT: endpoint, OTEL_LOGS_EXPORTER: "otlp" },
			"src/telemetry-test-fixtures/shutdown-time.ts",
		);
		const [elapsed] = stdout.split("\n").filter((line) => /^\d+$/.test(line));
		expect(code).toBe(0);
		expect(Number(elapsed)).toBeLessThan(1_500);
		// The script exits with it: no retry timer outlives the shutdown.
		expect(performance.now() - startedAt).toBeLessThan(4_000);
		expect(stderr.match(/Telemetry: the final export to/g)).toHaveLength(1);
		expect(stderr).toContain(endpoint);
	}, 30_000);

	it("resolves after one exporter timeout when a collector accepts the export and never answers", async () => {
		const sockets = new Set<import("node:net").Socket>();
		const silent = createServer(() => undefined);
		silent.on("connection", (socket) => sockets.add(socket));
		await new Promise<void>((resolve) =>
			silent.listen(0, "127.0.0.1", resolve),
		);
		const { port } = silent.address() as AddressInfo;
		try {
			const { stdout, stderr } = await fixtureRun(
				{
					OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
					OTEL_LOGS_EXPORTER: "otlp",
				},
				"src/telemetry-test-fixtures/shutdown-time.ts",
			);
			const [elapsed] = stdout.split("\n").filter((line) => /^\d+$/.test(line));
			expect(elapsed).toBeDefined();
			expect(Number(elapsed)).toBeGreaterThanOrEqual(900);
			expect(Number(elapsed)).toBeLessThan(1_500);
			expect(stderr).toContain("Telemetry: the final export to");
		} finally {
			for (const socket of sockets) {
				socket.destroy();
			}
			silent.close();
		}
	}, 30_000);

	it("names no credentials from the endpoint in the warning", async () => {
		const { stderr } = await fixtureRun(
			{
				OTEL_EXPORTER_OTLP_ENDPOINT: "http://user:secret@127.0.0.1:9",
				OTEL_LOGS_EXPORTER: "otlp",
			},
			"src/telemetry-test-fixtures/shutdown-time.ts",
		);
		expect(stderr).toContain("http://127.0.0.1:9");
		expect(stderr).not.toContain("secret");
	}, 30_000);
});
