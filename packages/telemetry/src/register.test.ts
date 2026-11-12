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
): Promise<{ code: number | null; stderr: string }> =>
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
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on("close", (code) => resolve({ code, stderr }));
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
		const { code } = await fixtureRun({
			OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
		});
		expect(code).toBe(0);
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

	it("fails quietly when no collector runs", async () => {
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
		expect(lines).toEqual([]);
	}, 30_000);
});
