import { once } from "node:events";
import { createServer, type Server } from "node:http";
import protobuf from "protobufjs";
import type { AppProcess } from "./production-server.ts";

type OtlpAttribute = {
	key: string;
	value: { intValue?: number | string; stringValue?: string };
};

export type OtlpSpan = {
	attributes: OtlpAttribute[];
	kind: number;
	name: string;
	parentSpanId?: string;
	spanId: string;
	traceId: string;
};

export type OtlpHistogramPoint = { attributes: OtlpAttribute[]; count: string };

export type OtlpMetric = {
	histogram?: { dataPoints: OtlpHistogramPoint[] };
	name: string;
};

/** `await using` closes the receiver at the end of the block, like `close`. */
export type OtlpReceiver = AsyncDisposable & {
	close: () => Promise<void>;
	/** Every request body by signal path: /v1/traces, /v1/logs, /v1/metrics. */
	bodies: Record<string, Buffer[]>;
	endpoint: string;
	metrics: () => OtlpMetric[];
	spans: () => OtlpSpan[];
};

// The OTLP fields the tests read; decoding skips every other field.
const otlpProto = protobuf.parse(`
syntax = "proto3";
message AnyValue { string string_value = 1; int64 int_value = 3; }
message KeyValue { string key = 1; AnyValue value = 2; }
message Span {
	bytes trace_id = 1; bytes span_id = 2; bytes parent_span_id = 4;
	string name = 5; int32 kind = 6; repeated KeyValue attributes = 9;
}
message ScopeSpans { repeated Span spans = 2; }
message ResourceSpans { repeated ScopeSpans scope_spans = 2; }
message TracesData { repeated ResourceSpans resource_spans = 1; }
message HistogramDataPoint { fixed64 count = 4; repeated KeyValue attributes = 9; }
message Histogram { repeated HistogramDataPoint data_points = 1; }
message Metric { string name = 1; Histogram histogram = 9; }
message ScopeMetrics { repeated Metric metrics = 2; }
message ResourceMetrics { repeated ScopeMetrics scope_metrics = 2; }
message MetricsData { repeated ResourceMetrics resource_metrics = 1; }
`).root;

// Decodes each body like the OTLP JSON encoding: camelCase keys, hex ids, 64-bit ints as strings.
const otlpDecode = <T>(type: string, bodies: Buffer[] = []): T[] => {
	const message = otlpProto.lookupType(type);
	return bodies.map(
		(body) =>
			message.toObject(message.decode(body), {
				arrays: true,
				bytes: String,
				longs: String,
			}) as T,
	);
};

// An absent id decodes to "", like a root span's parentSpanId in OTLP JSON.
const hex = (base64 = ""): string =>
	Buffer.from(base64, "base64").toString("hex");

/** A small OTLP/HTTP protobuf receiver inside the test that keeps every body it is sent. */
export const otlpReceiverStart = async (): Promise<OtlpReceiver> => {
	const bodies: Record<string, Buffer[]> = {};
	const server: Server = createServer(async (request, response) => {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(chunk);
		const path = request.url ?? "";
		bodies[path] = [...(bodies[path] ?? []), Buffer.concat(chunks)];
		response.writeHead(200, { "content-type": "application/x-protobuf" }).end();
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (address === null || typeof address === "string") {
		throw new Error("no receiver port");
	}
	const close = (): Promise<void> =>
		new Promise((resolve) => {
			server.close(() => resolve());
		});
	return {
		[Symbol.asyncDispose]: close,
		bodies,
		close,
		endpoint: `http://127.0.0.1:${address.port}`,
		metrics: () =>
			otlpDecode<{
				resourceMetrics: { scopeMetrics: { metrics: OtlpMetric[] }[] }[];
			}>("MetricsData", bodies["/v1/metrics"]).flatMap((data) =>
				data.resourceMetrics.flatMap((resource) =>
					resource.scopeMetrics.flatMap((scope) => scope.metrics),
				),
			),
		spans: () =>
			otlpDecode<{
				resourceSpans: { scopeSpans: { spans: OtlpSpan[] }[] }[];
			}>("TracesData", bodies["/v1/traces"]).flatMap((data) =>
				data.resourceSpans.flatMap((resource) =>
					resource.scopeSpans.flatMap((scope) =>
						scope.spans.map((span) => ({
							...span,
							parentSpanId: hex(span.parentSpanId),
							spanId: hex(span.spanId),
							traceId: hex(span.traceId),
						})),
					),
				),
			),
	};
};

/** OTLP export settings for a child process, with short batch delays. */
export const otlpEnv = (receiver: OtlpReceiver): Record<string, string> => ({
	OTEL_BLRP_SCHEDULE_DELAY: "100",
	OTEL_BSP_SCHEDULE_DELAY: "100",
	OTEL_EXPORTER_OTLP_ENDPOINT: receiver.endpoint,
	OTEL_LOGS_EXPORTER: "otlp",
	OTEL_METRIC_EXPORT_INTERVAL: "1000",
	OTEL_METRICS_EXPORTER: "otlp",
	OTEL_TRACES_EXPORTER: "otlp",
});

/** The ancestors of `span` in `spans`, nearest first. */
export const spanAncestors = (
	span: OtlpSpan,
	spans: OtlpSpan[],
): OtlpSpan[] => {
	const ancestors: OtlpSpan[] = [];
	let parentId = span.parentSpanId;
	while (parentId) {
		const parent = spans.find(
			(item) => item.spanId === parentId && item.traceId === span.traceId,
		);
		if (parent === undefined) break;
		ancestors.push(parent);
		parentId = parent.parentSpanId;
	}
	return ancestors;
};

export const spanAttribute = (
	span: OtlpSpan,
	key: string,
): string | undefined => {
	const value = span.attributes.find((item) => item.key === key)?.value;
	return value?.stringValue ?? value?.intValue?.toString();
};

export const spanKindServer = 2;
export const spanKindClient = 3;

// Personal data a user might type: an email, a test card number and a health term.
export const canaries = {
	card: "4111111111111111",
	email: "canary.person@example.com",
	health: "hypertension",
};

// Protobuf keeps strings as raw bytes, so a latin1 read finds any string sent.
const bodiesText = (bodies: Buffer[] = []): string =>
	bodies.map((body) => body.toString("latin1")).join("\n");

/** Everything a server sent out of the process: stdout, stderr and each OTLP signal. */
export const telemetrySignals = (
	app: AppProcess,
	receiver: OtlpReceiver,
): Record<string, string> => ({
	logs: bodiesText(receiver.bodies["/v1/logs"]),
	metrics: bodiesText(receiver.bodies["/v1/metrics"]),
	stderr: app.stderr(),
	stdout: app.stdout(),
	traces: bodiesText(receiver.bodies["/v1/traces"]),
});

/** The names of the signals whose text contains `value`. */
export const signalsLeaking = (
	signals: Record<string, string>,
	value: string,
): string[] =>
	Object.entries(signals)
		.filter(([, text]) => text.includes(value))
		.map(([name]) => name);
