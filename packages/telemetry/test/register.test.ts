import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
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

// A small OTLP/HTTP JSON receiver that keeps every span and log body it is sent.
const receiverStart = async (): Promise<{
	logs: string[];
	server: Server;
	spans: OtlpSpan[];
}> => {
	const logs: string[] = [];
	const spans: OtlpSpan[] = [];
	const server = createServer(async (request, response) => {
		let body = "";
		for await (const chunk of request) {
			body += chunk;
		}
		if (request.url === "/v1/logs") {
			logs.push(body);
		}
		if (request.url === "/v1/traces") {
			const traces = JSON.parse(body) as OtlpTraces;
			for (const resource of traces.resourceSpans) {
				for (const scope of resource.scopeSpans) {
					spans.push(...scope.spans);
				}
			}
		}
		response.writeHead(200, { "content-type": "application/json" }).end("{}");
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return { logs, server, spans };
};

const fixtureRun = (
	env: Record<string, string>,
	fixture = "test/fixture/server.ts",
): Promise<{ code: number | null; stderr: string }> =>
	new Promise((resolve) => {
		const child = spawn(
			process.execPath,
			[
				"--import",
				"@n8io/baseline-telemetry/register",
				"--experimental-loader=@opentelemetry/instrumentation/hook.mjs",
				fixture,
			],
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
	it("exports http server spans from a native TS process (V15)", async () => {
		const started = await receiverStart();
		receiver = started.server;
		const { port } = started.server.address() as AddressInfo;
		const { code } = await fixtureRun({
			OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
			OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
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

	it("exports records from a logger the app creates after the preload (V16)", async () => {
		const started = await receiverStart();
		receiver = started.server;
		const { port } = started.server.address() as AddressInfo;
		const { code } = await fixtureRun(
			{
				OTEL_BLRP_SCHEDULE_DELAY: "50",
				OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
				OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
				OTEL_LOGS_EXPORTER: "otlp",
				OTEL_TRACES_EXPORTER: "none",
			},
			"test/fixture/logger.ts",
		);
		expect(code).toBe(0);
		expect(started.logs.join("\n")).toContain('"stringValue":"fixture record"');
	}, 30_000);

	it("fails quietly when no collector runs", async () => {
		const { code, stderr } = await fixtureRun({
			OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:9",
		});
		expect(code).toBe(0);
		// Node's own ExperimentalWarning for --experimental-loader is the only line.
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
