import { Console } from "node:console";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo, Socket } from "node:net";
import { PassThrough } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import { context, logs, metrics, propagation, trace } from "@opentelemetry/api";
import protobuf from "protobufjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { telemetryShutdown, telemetryStart } from "./telemetry.ts";

type OtlpSpan = {
	attributes: { key: string; value: { stringValue?: string } }[];
	kind: number;
	name: string;
};

type Collector = {
	// Raw log request bodies, kept as latin1 text: protobuf stores strings as raw bytes.
	logs: string[];
	metricNames: string[];
	// The path of every request, in arrival order.
	paths: string[];
	spans: OtlpSpan[];
	url: string;
};

type Signal = "LOGS" | "METRICS" | "TRACES";

type Run = {
	collector: Collector;
	elapsedMs: number;
	output: string;
	warnings: string[];
};

const spanKindServer = 2;
const spanKindClient = 3;

// The OTLP fields the tests read; decoding skips every other field.
const dataTypes = protobuf.parse(`
syntax = "proto3";
message AnyValue { string string_value = 1; }
message KeyValue { string key = 1; AnyValue value = 2; }
message Span { string name = 5; int32 kind = 6; repeated KeyValue attributes = 9; }
message ScopeSpans { repeated Span spans = 2; }
message ResourceSpans { repeated ScopeSpans scope_spans = 2; }
message TracesData { repeated ResourceSpans resource_spans = 1; }
message Metric { string name = 1; }
message ScopeMetrics { repeated Metric metrics = 2; }
message ResourceMetrics { repeated ScopeMetrics scope_metrics = 2; }
message MetricsData { repeated ResourceMetrics resource_metrics = 1; }
`).root;
const tracesData = dataTypes.lookupType("TracesData");
const metricsData = dataTypes.lookupType("MetricsData");

type TracesObject = {
	resourceSpans: { scopeSpans: { spans: OtlpSpan[] }[] }[];
};
type MetricsObject = {
	resourceMetrics: { scopeMetrics: { metrics: { name: string }[] }[] }[];
};

const servers: Server[] = [];
const sockets = new Set<Socket>();

const serverStart = async (
	handler: (
		request: IncomingMessage,
		response: ServerResponse,
	) => Promise<void> | void,
): Promise<{ port: number; server: Server }> => {
	const server = createServer((request, response) => {
		void handler(request, response);
	});
	server.on("connection", (socket) => sockets.add(socket));
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return { port: (server.address() as AddressInfo).port, server };
};

// An OTLP/HTTP protobuf receiver that keeps what it is sent.
const collectorStart = async (): Promise<Collector> => {
	const collector: Collector = {
		logs: [],
		metricNames: [],
		paths: [],
		spans: [],
		url: "",
	};
	const { port } = await serverStart(async (request, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) {
			chunks.push(chunk);
		}
		const body = Buffer.concat(chunks);
		collector.paths.push(request.url ?? "");
		if (request.url === "/v1/logs") {
			collector.logs.push(body.toString("latin1"));
		}
		if (request.url === "/v1/traces") {
			const decoded = tracesData.toObject(tracesData.decode(body), {
				arrays: true,
			}) as TracesObject;
			for (const resource of decoded.resourceSpans) {
				for (const scope of resource.scopeSpans) {
					collector.spans.push(...scope.spans);
				}
			}
		}
		if (request.url === "/v1/metrics") {
			const decoded = metricsData.toObject(metricsData.decode(body), {
				arrays: true,
			}) as MetricsObject;
			for (const resource of decoded.resourceMetrics) {
				for (const scope of resource.scopeMetrics) {
					collector.metricNames.push(...scope.metrics.map(({ name }) => name));
				}
			}
		}
		response.writeHead(200, { "content-type": "application/x-protobuf" }).end();
	});
	collector.url = `http://127.0.0.1:${port}`;
	return collector;
};

// Accepts every connection and never answers.
const silentStart = async (): Promise<string> => {
	const { port } = await serverStart(() => undefined);
	return `http://127.0.0.1:${port}`;
};

// A port that was free a moment ago and has nothing listening.
const closedUrl = async (): Promise<string> => {
	const { port, server } = await serverStart(() => undefined);
	await new Promise((resolve) => server.close(resolve));
	return `http://127.0.0.1:${port}`;
};

const until = async (check: () => boolean, limitMs = 5_000): Promise<void> => {
	const stop = performance.now() + limitMs;
	while (!check() && performance.now() < stop) {
		await sleep(10);
	}
};

const emitAll = (): void => {
	trace.getTracer("test").startSpan("work").end();
	logs.getLogger("test").emit({ body: "work" });
	metrics.getMeter("test").createCounter("work.count").add(1);
};

const signals: { emit: () => void; path: string; signal: Signal }[] = [
	{
		emit: () => trace.getTracer("test").startSpan("work").end(),
		path: "/v1/traces",
		signal: "TRACES",
	},
	{
		emit: () => logs.getLogger("test").emit({ body: "work" }),
		path: "/v1/logs",
		signal: "LOGS",
	},
	{
		emit: () => metrics.getMeter("test").createCounter("work.count").add(1),
		path: "/v1/metrics",
		signal: "METRICS",
	},
];

const signalsOtherThan = (signal: Signal): Signal[] =>
	signals.map((item) => item.signal).filter((name) => name !== signal);

const exporterNone = (...names: Signal[]): Record<string, string> =>
	Object.fromEntries(names.map((name) => [`OTEL_${name}_EXPORTER`, "none"]));

const globalsDisable = (): void => {
	trace.disable();
	metrics.disable();
	logs.disable();
	context.disable();
	propagation.disable();
};

const warningsSeen: string[] = [];
const onWarning = (warning: Error): void => {
	warningsSeen.push(warning.message);
};
let envSaved: [string, string | undefined][] = [];

const otelNames = (): string[] =>
	Object.keys(process.env).filter((name) => name.startsWith("OTEL_"));

beforeEach(() => {
	envSaved = otelNames().map((name) => [name, process.env[name]]);
	for (const name of otelNames()) {
		delete process.env[name];
	}
	warningsSeen.length = 0;
	process.on("warning", onWarning);
});

afterEach(async () => {
	await telemetryShutdown();
	process.off("warning", onWarning);
	globalsDisable();
	for (const name of otelNames()) {
		delete process.env[name];
	}
	for (const [name, value] of envSaved) {
		if (value !== undefined) {
			process.env[name] = value;
		}
	}
	for (const socket of sockets) {
		socket.destroy();
	}
	sockets.clear();
	await Promise.all(
		servers
			.splice(0)
			.map((server) => new Promise((resolve) => server.close(resolve))),
	);
});

// Starts telemetry with `env` set, runs `work`, shuts down, and says what was exported, printed and
// warned. The console is a real one that writes to a string, so the console exporters can be read.
const telemetryRun = async (
	env: Record<string, string>,
	collector: Collector,
	work: (collector: Collector) => Promise<void> | void = emitAll,
): Promise<Run> => {
	warningsSeen.length = 0;
	for (const name of otelNames()) {
		delete process.env[name];
	}
	for (const [name, value] of Object.entries(env)) {
		process.env[name] = value;
	}
	const sink = new PassThrough();
	let output = "";
	sink.on("data", (chunk: Buffer) => {
		output += chunk.toString();
	});
	const consoleOriginal = globalThis.console;
	globalThis.console = new Console(sink);
	try {
		telemetryStart();
		await work(collector);
		const startedAt = performance.now();
		await telemetryShutdown();
		const elapsedMs = performance.now() - startedAt;
		await sleep(0);
		globalsDisable();
		return { collector, elapsedMs, output, warnings: [...warningsSeen] };
	} finally {
		globalThis.console = consoleOriginal;
	}
};

const runWith = async (
	env: Record<string, string>,
	work?: (collector: Collector) => Promise<void> | void,
): Promise<Run> => {
	const collector = await collectorStart();
	return telemetryRun(
		{ OTEL_EXPORTER_OTLP_ENDPOINT: collector.url, ...env },
		collector,
		work,
	);
};

const attribute = (span: OtlpSpan, key: string): string | undefined =>
	span.attributes.find((item) => item.key === key)?.value.stringValue;

const warningFinal = (endpoint: string): string =>
	`Telemetry: the final export to ${endpoint} failed or timed out; unsent telemetry was lost.`;

describe("telemetryStart", () => {
	it("exports nothing, and warns of nothing, when no OTLP endpoint is set", async () => {
		const collector = await collectorStart();
		const run = await telemetryRun({}, collector);
		expect(run.collector.paths).toEqual([]);
		expect(run.warnings).toEqual([]);
		expect(run.output).toBe("");
	});

	it("sends each signal to the endpoint every signal shares", async () => {
		const { collector } = await runWith({});
		expect([...new Set(collector.paths)].sort()).toEqual([
			"/v1/logs",
			"/v1/metrics",
			"/v1/traces",
		]);
		expect(collector.spans.map((span) => span.name)).toContain("work");
		expect(collector.metricNames).toContain("work.count");
		expect(collector.logs.join("")).toContain("work");
	});

	for (const { emit, path, signal } of signals) {
		it(`exports only ${signal} when only its own endpoint is set`, async () => {
			const collector = await collectorStart();
			const run = await telemetryRun(
				{
					[`OTEL_EXPORTER_OTLP_${signal}_ENDPOINT`]: `${collector.url}${path}`,
				},
				collector,
				() => {
					emitAll();
					emit();
				},
			);
			expect([...new Set(run.collector.paths)]).toEqual([path]);
			expect(run.warnings).toEqual([]);
		});

		it(`exports no ${signal} when its exporter is none`, async () => {
			const { collector } = await runWith(exporterNone(signal));
			expect(collector.paths).not.toContain(path);
			expect(collector.paths).toHaveLength(2);
		});

		it(`exports no ${signal} when none is listed among other exporters`, async () => {
			const { collector, output } = await runWith({
				[`OTEL_${signal}_EXPORTER`]: "console,none,otlp",
			});
			expect(collector.paths).not.toContain(path);
			expect(output).toBe("");
		});

		it(`exports no ${signal} for an exporter it does not know`, async () => {
			const { collector, output } = await runWith({
				[`OTEL_${signal}_EXPORTER`]: "zipkin",
			});
			expect(collector.paths).not.toContain(path);
			expect(output).toBe("");
		});

		it(`exports ${signal} over OTLP with no endpoint setting at all when otlp is named`, async () => {
			const collector = await collectorStart();
			const run = await telemetryRun(
				{
					...exporterNone(...signalsOtherThan(signal)),
					[`OTEL_${signal}_EXPORTER`]: "otlp",
					[`OTEL_EXPORTER_OTLP_${signal}_ENDPOINT`]: `${collector.url}${path}`,
				},
				collector,
			);
			expect(run.collector.paths).toEqual([path]);
		});

		it(`exports ${signal} to the console and to OTLP when both are named, with spaces and an empty item`, async () => {
			const { collector, output } = await runWith({
				...exporterNone(...signalsOtherThan(signal)),
				[`OTEL_${signal}_EXPORTER`]: " console , ,otlp ",
			});
			expect(collector.paths).toEqual([path]);
			expect(output).toContain("work");
		});

		it(`exports ${signal} to the console alone, with no warning about a final export`, async () => {
			const { collector, output, warnings } = await runWith({
				...exporterNone(...signalsOtherThan(signal)),
				[`OTEL_${signal}_EXPORTER`]: "console",
			});
			expect(collector.paths).toEqual([]);
			expect(output).toContain("work");
			expect(warnings).toEqual([]);
		});

		it(`exports no ${signal} when its endpoint is blank`, async () => {
			const collector = await collectorStart();
			const run = await telemetryRun(
				{
					[`OTEL_EXPORTER_OTLP_${signal}_ENDPOINT`]: "   ",
				},
				collector,
			);
			expect(run.collector.paths).toEqual([]);
			expect(run.warnings).toEqual([]);
		});
	}

	it("exports nothing when the shared endpoint is blank", async () => {
		const collector = await collectorStart();
		const run = await telemetryRun(
			{ OTEL_EXPORTER_OTLP_ENDPOINT: "  " },
			collector,
		);
		expect(run.collector.paths).toEqual([]);
		expect(run.warnings).toEqual([]);
	});

	it("sets OTEL_SEMCONV_EXCEPTION_SIGNAL_OPT_IN to logs unless it is set", async () => {
		const collector = await collectorStart();
		await telemetryRun({}, collector);
		expect(process.env["OTEL_SEMCONV_EXCEPTION_SIGNAL_OPT_IN"]).toBe("logs");
		delete process.env["OTEL_SEMCONV_EXCEPTION_SIGNAL_OPT_IN"];
		await telemetryRun(
			{ OTEL_SEMCONV_EXCEPTION_SIGNAL_OPT_IN: "database" },
			collector,
		);
		expect(process.env["OTEL_SEMCONV_EXCEPTION_SIGNAL_OPT_IN"]).toBe(
			"database",
		);
	});

	it("leaves OTEL_LOGS_EXPORTER as it found it", async () => {
		const collector = await collectorStart();
		await telemetryRun({}, collector);
		expect("OTEL_LOGS_EXPORTER" in process.env).toBe(false);
		await telemetryRun({ OTEL_LOGS_EXPORTER: "none" }, collector);
		expect(process.env["OTEL_LOGS_EXPORTER"]).toBe("none");
		await telemetryRun({ OTEL_LOGS_EXPORTER: "console" }, collector);
		expect(process.env["OTEL_LOGS_EXPORTER"]).toBe("console");
		await telemetryRun({ OTEL_LOGS_EXPORTER: "zipkin" }, collector);
		expect(process.env["OTEL_LOGS_EXPORTER"]).toBe("zipkin");
	});

	it("starts once however many times it is called", async () => {
		const { warnings } = await runWith(
			{ OTEL_EXPORTER_OTLP_PROTOCOL: "grpc" },
			() => {
				telemetryStart();
				telemetryStart();
			},
		);
		expect(warnings).toHaveLength(1);
	});

	it("warns once, naming each protocol setting that is not http/protobuf, and still exports", async () => {
		const { collector, warnings } = await runWith({
			OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: "http/json",
			OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: "grpc",
			OTEL_EXPORTER_OTLP_PROTOCOL: "grpc",
			OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: "http/json",
		});
		expect(warnings).toEqual([
			"OTEL_EXPORTER_OTLP_PROTOCOL, OTEL_EXPORTER_OTLP_LOGS_PROTOCOL, OTEL_EXPORTER_OTLP_METRICS_PROTOCOL, OTEL_EXPORTER_OTLP_TRACES_PROTOCOL ignored: telemetry exports OTLP over http/protobuf only.",
		]);
		expect(collector.spans.length).toBeGreaterThan(0);
	});

	it("does not warn about protocols that are http/protobuf, blank, or unset", async () => {
		const { warnings } = await runWith({
			OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: "   ",
			OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: " http/protobuf ",
			OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
		});
		expect(warnings).toEqual([]);
	});

	it("redacts query values on exported spans before they leave", async () => {
		const { collector } = await runWith({}, () => {
			const span = trace.getTracer("test").startSpan("GET");
			span.setAttributes({
				"url.full": "https://api.example.com/foos?email=jane@example.com#top",
				"url.query": "email=jane@example.com&page=2",
			});
			span.end();
		});
		const [span] = collector.spans;
		expect(attribute(span as OtlpSpan, "url.query")).toBe(
			"email=REDACTED&page=REDACTED",
		);
		expect(attribute(span as OtlpSpan, "url.full")).toBe(
			"https://api.example.com/foos?email=REDACTED#top",
		);
	});

	it("keeps an exception message out of exported log records", async () => {
		const { collector } = await runWith({}, () => {
			const error = new Error("insert failed for jane@example.com");
			error.name = "FooInsertError";
			logs.getLogger("test").emit({ body: error.message, exception: error });
		});
		const text = collector.logs.join("");
		expect(text).not.toContain("jane@example.com");
		expect(text).toContain("FooInsertError");
	});

	it("traces an incoming http request, and not a health probe", async () => {
		const { collector } = await runWith({}, async () => {
			const http = createRequire(import.meta.url)(
				"node:http",
			) as typeof import("node:http");
			const server = http.createServer((_request, response) => {
				response.end("ok");
			});
			servers.push(server);
			await new Promise<void>((resolve) =>
				server.listen(0, "127.0.0.1", resolve),
			);
			const { port } = server.address() as AddressInfo;
			for (const path of [
				"/foos?name=canary",
				"/livez",
				"/readyz",
				"/livez?probe=1",
				"/readyz/deep",
			]) {
				await (await fetch(`http://127.0.0.1:${port}${path}`)).text();
			}
		});
		const served = collector.spans.filter(
			(span) => span.kind === spanKindServer,
		);
		expect(served.map((span) => attribute(span, "url.path"))).toEqual([
			"/foos",
			"/readyz/deep",
		]);
		expect(attribute(served[0] as OtlpSpan, "url.query")).toBe("name=REDACTED");
		const called = collector.spans.filter(
			(span) => span.kind === spanKindClient,
		);
		expect(called.map((span) => attribute(span, "url.full"))).toContainEqual(
			expect.stringMatching(/\/foos\?name=REDACTED$/),
		);
		expect(JSON.stringify(collector.spans)).not.toContain("canary");
	});
});

const spansEnded = (count: number): void => {
	for (let index = 0; index < count; index += 1) {
		trace.getTracer("test").startSpan(`work-${index}`).end();
	}
};

const logsEmitted = (count: number): void => {
	for (let index = 0; index < count; index += 1) {
		logs.getLogger("test").emit({ body: `work-${index}` });
	}
};

const batchKinds = [
	{
		count: spansEnded,
		path: "/v1/traces",
		prefix: "BSP",
		signal: "TRACES",
	},
	{ count: logsEmitted, path: "/v1/logs", prefix: "BLRP", signal: "LOGS" },
] as const;

describe("batch settings", () => {
	for (const { count, path, prefix, signal } of batchKinds) {
		const only = exporterNone(...signalsOtherThan(signal));

		it(`exports ${signal} in the background every OTEL_${prefix}_SCHEDULE_DELAY milliseconds`, async () => {
			const early: string[] = [];
			const { collector } = await runWith(
				{ ...only, [`OTEL_${prefix}_SCHEDULE_DELAY`]: "50" },
				async (seen) => {
					count(1);
					await until(() => seen.paths.length > 0, 2_000);
					early.push(...seen.paths);
				},
			);
			expect(early).toEqual([path]);
			expect(collector.paths).toEqual([path]);
		});

		for (const value of [undefined, "", "0", "-1", "abc"]) {
			it(`holds ${signal} until shutdown when OTEL_${prefix}_SCHEDULE_DELAY is ${JSON.stringify(value)}`, async () => {
				const collector = await collectorStart();
				const early: string[] = [];
				await telemetryRun(
					{
						...only,
						OTEL_EXPORTER_OTLP_ENDPOINT: collector.url,
						...(value === undefined
							? {}
							: { [`OTEL_${prefix}_SCHEDULE_DELAY`]: value }),
					},
					collector,
					async () => {
						count(1);
						await sleep(300);
						early.push(...collector.paths);
					},
				);
				expect(early).toEqual([]);
				expect(collector.paths).toEqual([path]);
			});
		}

		it(`exports ${signal} in batches of at most OTEL_${prefix}_MAX_EXPORT_BATCH_SIZE`, async () => {
			const { collector } = await runWith(
				{ ...only, [`OTEL_${prefix}_MAX_EXPORT_BATCH_SIZE`]: "1" },
				() => count(3),
			);
			expect(collector.paths).toEqual([path, path, path]);
		});

		it(`exports ${signal} in one batch without OTEL_${prefix}_MAX_EXPORT_BATCH_SIZE`, async () => {
			const { collector } = await runWith(only, () => count(3));
			expect(collector.paths).toEqual([path]);
		});

		it(`drops ${signal} beyond OTEL_${prefix}_MAX_QUEUE_SIZE`, async () => {
			const { collector } = await runWith(
				{ ...only, [`OTEL_${prefix}_MAX_QUEUE_SIZE`]: "2" },
				() => count(5),
			);
			const text =
				signal === "TRACES"
					? collector.spans.map((span) => span.name).join(",")
					: collector.logs.join("");
			expect(text).toContain("work-0");
			expect(text).not.toContain("work-4");
		});

		if (prefix === "BSP") {
			// BatchLogRecordProcessor does not bound its shutdown flush by this setting.
			it(`gives up on ${signal} after OTEL_${prefix}_EXPORT_TIMEOUT milliseconds`, async () => {
				const silent = await silentStart();
				const collector = await collectorStart();
				const run = await telemetryRun(
					{
						...only,
						[`OTEL_${prefix}_EXPORT_TIMEOUT`]: "300",
						OTEL_EXPORTER_OTLP_ENDPOINT: silent,
						OTEL_EXPORTER_OTLP_TIMEOUT: "20000",
					},
					collector,
					() => count(1),
				);
				expect(run.elapsedMs).toBeGreaterThanOrEqual(250);
				expect(run.elapsedMs).toBeLessThan(2_000);
				expect(run.warnings).toHaveLength(1);
			}, 15_000);
		}
	}
});

describe("exporter timeout", () => {
	for (const { emit, signal } of signals) {
		const only = exporterNone(...signalsOtherThan(signal));

		it(`times out ${signal} export after OTEL_EXPORTER_OTLP_${signal}_TIMEOUT, before the shared one`, async () => {
			const silent = await silentStart();
			const collector = await collectorStart();
			const run = await telemetryRun(
				{
					...only,
					OTEL_EXPORTER_OTLP_ENDPOINT: silent,
					[`OTEL_EXPORTER_OTLP_${signal}_TIMEOUT`]: "300",
					OTEL_EXPORTER_OTLP_TIMEOUT: "20000",
				},
				collector,
				emit,
			);
			expect(run.elapsedMs).toBeGreaterThanOrEqual(250);
			expect(run.elapsedMs).toBeLessThan(900);
			expect(run.warnings).toEqual([warningFinal(`${silent}/`)]);
		}, 15_000);

		it(`ignores another signal's timeout for ${signal}`, async () => {
			const silent = await silentStart();
			const collector = await collectorStart();
			const [other] = signalsOtherThan(signal);
			const run = await telemetryRun(
				{
					...only,
					OTEL_EXPORTER_OTLP_ENDPOINT: silent,
					[`OTEL_EXPORTER_OTLP_${other}_TIMEOUT`]: "100",
				},
				collector,
				emit,
			);
			expect(run.elapsedMs).toBeGreaterThanOrEqual(900);
			expect(run.elapsedMs).toBeLessThan(2_000);
		}, 15_000);
	}

	it("falls back to the shared timeout when the signal's own is not a positive number", async () => {
		const silent = await silentStart();
		const collector = await collectorStart();
		const run = await telemetryRun(
			{
				...exporterNone("LOGS", "METRICS"),
				OTEL_EXPORTER_OTLP_ENDPOINT: silent,
				OTEL_EXPORTER_OTLP_TIMEOUT: "300",
				OTEL_EXPORTER_OTLP_TRACES_TIMEOUT: "abc",
			},
			collector,
			() => spansEnded(1),
		);
		expect(run.elapsedMs).toBeGreaterThanOrEqual(250);
		expect(run.elapsedMs).toBeLessThan(900);
	}, 15_000);

	for (const value of ["abc", "0", "-5", ""]) {
		it(`times out after one second when the timeout is ${JSON.stringify(value)}`, async () => {
			const silent = await silentStart();
			const collector = await collectorStart();
			const run = await telemetryRun(
				{
					...exporterNone("LOGS", "METRICS"),
					OTEL_EXPORTER_OTLP_ENDPOINT: silent,
					OTEL_EXPORTER_OTLP_TIMEOUT: value,
				},
				collector,
				() => spansEnded(1),
			);
			expect(run.elapsedMs).toBeGreaterThanOrEqual(900);
			expect(run.elapsedMs).toBeLessThan(1_800);
			expect(run.warnings).toHaveLength(1);
		}, 15_000);
	}
});

describe("metric reader settings", () => {
	const only = exporterNone("LOGS", "TRACES");

	it("exports metrics every OTEL_METRIC_EXPORT_INTERVAL milliseconds", async () => {
		const early: string[] = [];
		await runWith(
			{ ...only, OTEL_METRIC_EXPORT_INTERVAL: "100" },
			async (seen) => {
				metrics.getMeter("test").createCounter("work.count").add(1);
				await until(() => seen.metricNames.includes("work.count"), 2_000);
				early.push(...seen.metricNames);
			},
		);
		expect(early).toContain("work.count");
	});

	for (const value of [undefined, "", "0", "-1", "abc"]) {
		it(`holds metrics until shutdown when the interval is ${JSON.stringify(value)}`, async () => {
			const collector = await collectorStart();
			const early: string[] = [];
			await telemetryRun(
				{
					...only,
					OTEL_EXPORTER_OTLP_ENDPOINT: collector.url,
					...(value === undefined
						? {}
						: { OTEL_METRIC_EXPORT_INTERVAL: value }),
				},
				collector,
				async () => {
					metrics.getMeter("test").createCounter("work.count").add(1);
					await sleep(300);
					early.push(...collector.paths);
				},
			);
			expect(early).toEqual([]);
			expect(collector.paths).toEqual(["/v1/metrics"]);
		});
	}
});

describe("telemetryShutdown", () => {
	it("resolves without a warning when nothing was started, and when called twice", async () => {
		await expect(telemetryShutdown()).resolves.toBeUndefined();
		const run = await runWith({});
		await expect(telemetryShutdown()).resolves.toBeUndefined();
		await sleep(0);
		expect(run.warnings).toEqual([]);
		expect(warningsSeen).toEqual([]);
	});

	it("warns once, naming the endpoint's origin and path and no credentials, when the collector is unreachable", async () => {
		const closed = await closedUrl();
		const collector = await collectorStart();
		const run = await telemetryRun(
			{
				...exporterNone("LOGS", "METRICS"),
				OTEL_EXPORTER_OTLP_ENDPOINT: `${closed.replace("http://", "http://user:secret@")}/base?token=abc`,
			},
			collector,
			() => spansEnded(1),
		);
		expect(run.warnings).toEqual([warningFinal(`${closed}/base`)]);
	}, 15_000);

	for (const { emit, signal } of signals) {
		it(`warns when the ${signal} export fails`, async () => {
			const closed = await closedUrl();
			const collector = await collectorStart();
			const run = await telemetryRun(
				{
					...exporterNone(...signalsOtherThan(signal)),
					[`OTEL_EXPORTER_OTLP_${signal}_ENDPOINT`]: `${closed}/v1/x`,
				},
				collector,
				emit,
			);
			expect(run.warnings).toEqual([warningFinal(`${closed}/v1/x`)]);
		}, 15_000);
	}

	it("names the shared endpoint before the signals' own, and the first set of those in order", async () => {
		const [shared, traces, metricsUrl, logsUrl] = await Promise.all([
			closedUrl(),
			closedUrl(),
			closedUrl(),
			closedUrl(),
		]);
		const collector = await collectorStart();
		const all = await telemetryRun(
			{
				OTEL_EXPORTER_OTLP_ENDPOINT: shared,
				OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: logsUrl,
				OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: metricsUrl,
				OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: traces,
			},
			collector,
		);
		expect(all.warnings).toEqual([warningFinal(`${shared}/`)]);
		const own = await telemetryRun(
			{
				OTEL_EXPORTER_OTLP_ENDPOINT: "   ",
				OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: logsUrl,
				OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: metricsUrl,
				OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: traces,
			},
			collector,
		);
		expect(own.warnings).toEqual([warningFinal(`${traces}/`)]);
		const rest = await telemetryRun(
			{
				OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: logsUrl,
				OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: metricsUrl,
			},
			collector,
		);
		expect(rest.warnings).toEqual([warningFinal(`${metricsUrl}/`)]);
	}, 30_000);

	it("names the OTLP endpoint when none is set to name", async () => {
		const collector = await collectorStart();
		const run = await telemetryRun(
			{
				...exporterNone("LOGS", "METRICS"),
				OTEL_TRACES_EXPORTER: "otlp",
			},
			collector,
			() => spansEnded(1),
		);
		expect(run.warnings).toEqual([warningFinal("the OTLP endpoint")]);
	}, 15_000);

	it("forgets an earlier failure when the next shutdown succeeds", async () => {
		const closed = await closedUrl();
		const collector = await collectorStart();
		const failed = await telemetryRun(
			{
				...exporterNone("LOGS", "METRICS"),
				OTEL_EXPORTER_OTLP_ENDPOINT: closed,
			},
			collector,
			() => spansEnded(1),
		);
		expect(failed.warnings).toHaveLength(1);
		const succeeded = await telemetryRun(
			{
				...exporterNone("LOGS", "METRICS"),
				OTEL_EXPORTER_OTLP_ENDPOINT: collector.url,
			},
			collector,
			() => spansEnded(1),
		);
		expect(succeeded.warnings).toEqual([]);
		expect(collector.paths).toEqual(["/v1/traces"]);
	}, 15_000);
});
