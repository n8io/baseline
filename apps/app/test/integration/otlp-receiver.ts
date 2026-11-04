import { once } from "node:events";
import { createServer, type Server } from "node:http";
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

export type OtlpReceiver = {
	close: () => Promise<void>;
	/** Every request body by signal path: /v1/traces, /v1/logs, /v1/metrics. */
	bodies: Record<string, string[]>;
	endpoint: string;
	spans: () => OtlpSpan[];
};

/** A small OTLP/HTTP JSON receiver inside the test that keeps every body it is sent. */
export const otlpReceiverStart = async (): Promise<OtlpReceiver> => {
	const bodies: Record<string, string[]> = {};
	const server: Server = createServer(async (request, response) => {
		let body = "";
		for await (const chunk of request) body += chunk;
		const path = request.url ?? "";
		bodies[path] = [...(bodies[path] ?? []), body];
		response.writeHead(200, { "content-type": "application/json" }).end("{}");
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (address === null || typeof address === "string") {
		throw new Error("no receiver port");
	}
	return {
		bodies,
		close: () =>
			new Promise((resolve) => {
				server.close(() => resolve());
			}),
		endpoint: `http://127.0.0.1:${address.port}`,
		spans: () =>
			(bodies["/v1/traces"] ?? []).flatMap((body) =>
				(
					JSON.parse(body) as {
						resourceSpans: { scopeSpans: { spans: OtlpSpan[] }[] }[];
					}
				).resourceSpans.flatMap((resource) =>
					resource.scopeSpans.flatMap((scope) => scope.spans),
				),
			),
	};
};

/** OTLP/HTTP JSON export settings for a child process, with short batch delays. */
export const otlpEnv = (receiver: OtlpReceiver): Record<string, string> => ({
	OTEL_BLRP_SCHEDULE_DELAY: "100",
	OTEL_BSP_SCHEDULE_DELAY: "100",
	OTEL_EXPORTER_OTLP_ENDPOINT: receiver.endpoint,
	OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
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

/** Everything a server sent out of the process: stdout, stderr and each OTLP signal. */
export const telemetrySignals = (
	app: AppProcess,
	receiver: OtlpReceiver,
): Record<string, string> => ({
	logs: (receiver.bodies["/v1/logs"] ?? []).join("\n"),
	metrics: (receiver.bodies["/v1/metrics"] ?? []).join("\n"),
	stderr: app.stderr(),
	stdout: app.stdout(),
	traces: (receiver.bodies["/v1/traces"] ?? []).join("\n"),
});

/** The names of the signals whose text contains `value`. */
export const signalsLeaking = (
	signals: Record<string, string>,
	value: string,
): string[] =>
	Object.entries(signals)
		.filter(([, text]) => text.includes(value))
		.map(([name]) => name);
