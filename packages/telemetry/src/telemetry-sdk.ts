import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { RedisInstrumentation } from "@opentelemetry/instrumentation-redis";
import { RuntimeNodeInstrumentation } from "@opentelemetry/instrumentation-runtime-node";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import {
	BatchLogRecordProcessor,
	ConsoleLogRecordExporter,
	type LogRecordProcessor,
	SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
	ConsoleMetricExporter,
	type IMetricReader,
	PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
	BatchSpanProcessor,
	ConsoleSpanExporter,
	SimpleSpanProcessor,
	type SpanProcessor,
} from "@opentelemetry/sdk-trace";
import {
	telemetryLogRecordCleanup,
	telemetrySpanCleanup,
} from "./telemetry-cleanup.ts";

// Probes are never traced.
const pathsHealth = new Set(["/livez", "/readyz"]);

// The OTEL_* settings NodeSDK reads only when it builds the processors and
// readers itself. It builds them only when given none, and the cleanup
// processors must run first, so this file builds them the same way from the
// same variables.

const envList = (name: string): string[] =>
	(process.env[name] ?? "")
		.split(",")
		.map((item) => item.trim())
		.filter((item) => item !== "");

// With no OTEL_<SIGNAL>_EXPORTER, a signal exports OTLP only where an endpoint is set for it
// (OTEL_EXPORTER_OTLP_ENDPOINT, or the signal's own). Otherwise nothing listens, and a process
// would wait at exit for the default localhost:4318 to refuse.
const exportersNamed = (signal: "LOGS" | "METRICS" | "TRACES"): string[] => {
	const names = envList(`OTEL_${signal}_EXPORTER`);
	if (names.includes("none")) {
		return [];
	}
	if (names.length > 0) {
		return names;
	}
	const endpointSet = [
		"OTEL_EXPORTER_OTLP_ENDPOINT",
		`OTEL_EXPORTER_OTLP_${signal}_ENDPOINT`,
	].some((name) => (process.env[name] ?? "").trim() !== "");
	return endpointSet ? ["otlp"] : [];
};

// OTLP goes over http/protobuf only, the OTel default.
const protocolNames = ["", "_LOGS", "_METRICS", "_TRACES"].map(
	(signal) => `OTEL_EXPORTER_OTLP${signal}_PROTOCOL`,
);

const protocolOthersWarn = (): void => {
	const others = protocolNames.filter((name) => {
		const value = process.env[name]?.trim();
		return value !== undefined && value !== "" && value !== "http/protobuf";
	});
	if (others.length > 0) {
		process.emitWarning(
			`${others.join(", ")} ignored: telemetry exports OTLP over http/protobuf only.`,
		);
	}
};

type BatchOptions = {
	exportTimeoutMillis?: number;
	maxExportBatchSize?: number;
	maxQueueSize?: number;
	scheduledDelayMillis?: number;
};

const batchOptionNames = [
	["exportTimeoutMillis", "EXPORT_TIMEOUT"],
	["maxExportBatchSize", "MAX_EXPORT_BATCH_SIZE"],
	["maxQueueSize", "MAX_QUEUE_SIZE"],
	["scheduledDelayMillis", "SCHEDULE_DELAY"],
] as const;

const batchOptions = (prefix: "BLRP" | "BSP"): BatchOptions => {
	const options: BatchOptions = {};
	for (const [option, name] of batchOptionNames) {
		const value = Number(process.env[`OTEL_${prefix}_${name}`]);
		if (Number.isFinite(value) && value > 0) {
			options[option] = value;
		}
	}
	return options;
};

// An unreachable collector makes an exporter retry for its whole timeout (10 s by default), and
// the retry timers keep a script alive that long after telemetryShutdown. So an exporter times
// out after 1 s unless OTEL_EXPORTER_OTLP_TIMEOUT (or the signal's own), in milliseconds, says
// otherwise. A value that is not a positive number counts as unset.
const exportTimeoutDefaultMillis = 1_000;

const exportTimeoutMillis = (signal: "LOGS" | "METRICS" | "TRACES"): number => {
	for (const name of [
		`OTEL_EXPORTER_OTLP_${signal}_TIMEOUT`,
		"OTEL_EXPORTER_OTLP_TIMEOUT",
	]) {
		const value = Number(process.env[name]);
		if (Number.isFinite(value) && value > 0) {
			return value;
		}
	}
	return exportTimeoutDefaultMillis;
};

const exportTimeout = (
	signal: "LOGS" | "METRICS" | "TRACES",
): { timeoutMillis: number } => ({
	timeoutMillis: exportTimeoutMillis(signal),
});

// ExportResultCode.SUCCESS in @opentelemetry/core.
const exportSuccess = 0;

let exportFailed = false;

// Notes a failed export, so telemetryShutdown can say so; the exporters drop failures quietly.
const exportWatch = <
	T extends {
		export(
			items: never,
			resultCallback: (result: { code: number }) => void,
		): void;
	},
>(
	exporter: T,
): T => {
	const exportOriginal = exporter.export.bind(exporter);
	exporter.export = (items, resultCallback) => {
		exportOriginal(items, (result) => {
			if (result.code !== exportSuccess) {
				exportFailed = true;
			}
			resultCallback(result);
		});
	};
	return exporter;
};

const spanProcessorsFromEnv = (): SpanProcessor[] =>
	exportersNamed("TRACES").flatMap((name): SpanProcessor[] => {
		if (name === "console") {
			return [new SimpleSpanProcessor({ exporter: new ConsoleSpanExporter() })];
		}
		if (name !== "otlp") {
			return [];
		}
		return [
			new BatchSpanProcessor({
				exporter: exportWatch(new OTLPTraceExporter(exportTimeout("TRACES"))),
				...batchOptions("BSP"),
			}),
		];
	});

const logRecordProcessorsFromEnv = (): LogRecordProcessor[] =>
	exportersNamed("LOGS").flatMap((name): LogRecordProcessor[] => {
		if (name === "console") {
			return [
				new SimpleLogRecordProcessor({
					exporter: new ConsoleLogRecordExporter(),
				}),
			];
		}
		if (name !== "otlp") {
			return [];
		}
		return [
			new BatchLogRecordProcessor({
				exporter: exportWatch(new OTLPLogExporter(exportTimeout("LOGS"))),
				...batchOptions("BLRP"),
			}),
		];
	});

// A reader's timeout may not exceed its interval.
const metricReaderOptions = (): {
	exportIntervalMillis: number;
	exportTimeoutMillis: number;
} => {
	const interval = Number(process.env.OTEL_METRIC_EXPORT_INTERVAL);
	const exportIntervalMillis =
		Number.isFinite(interval) && interval > 0 ? interval : 60_000;
	return {
		exportIntervalMillis,
		exportTimeoutMillis: Math.min(exportIntervalMillis, 30_000),
	};
};

// Metric attributes are set by code, never from input or error text.
const metricReadersFromEnv = (): IMetricReader[] =>
	exportersNamed("METRICS").flatMap((name): IMetricReader[] => {
		if (name !== "console" && name !== "otlp") {
			return [];
		}
		return [
			new PeriodicExportingMetricReader({
				exporter:
					name === "console"
						? new ConsoleMetricExporter()
						: exportWatch(new OTLPMetricExporter(exportTimeout("METRICS"))),
				...metricReaderOptions(),
			}),
		];
	});

let sdk: NodeSDK | undefined;

export const telemetryStart = (): void => {
	if (sdk !== undefined) {
		return;
	}
	// Exceptions as log records, not span events; read when instrumentations
	// are built, so it is set first.
	process.env.OTEL_SEMCONV_EXCEPTION_SIGNAL_OPT_IN ??= "logs";
	protocolOthersWarn();
	const spanProcessors = spanProcessorsFromEnv();
	const logRecordProcessors = logRecordProcessorsFromEnv();
	sdk = new NodeSDK({
		instrumentations: [
			new HttpInstrumentation({
				ignoreIncomingRequestHook: (request) =>
					pathsHealth.has((request.url ?? "").split("?")[0] ?? ""),
			}),
			new UndiciInstrumentation(),
			// requireParentSpan: a query or command outside a trace (a queue poll, boot, a
			// reconnect) makes no span; one inside a request, a job or a use case still does.
			new PgInstrumentation({
				enhancedDatabaseReporting: false,
				requireParentSpan: true,
			}),
			new RedisInstrumentation({ requireParentSpan: true }),
			new PinoInstrumentation(),
			new RuntimeNodeInstrumentation(),
		],
		// An empty list starts no meter provider (OTEL_METRICS_EXPORTER=none).
		metricReaders: metricReadersFromEnv(),
		spanProcessors:
			spanProcessors.length === 0
				? []
				: [telemetrySpanCleanup(), ...spanProcessors],
		// None given lets NodeSDK skip the logger provider (OTEL_LOGS_EXPORTER=none).
		...(logRecordProcessors.length === 0
			? {}
			: {
					logRecordProcessors: [
						telemetryLogRecordCleanup(),
						...logRecordProcessors,
					],
				}),
	});
	// NodeSDK builds its own OTLP log exporter from the environment when it is given no log
	// processor; a signal with no exporter must not get one. Traces and metrics are given empty
	// lists, which it keeps.
	const logsExporter = process.env.OTEL_LOGS_EXPORTER;
	if (logRecordProcessors.length === 0) {
		process.env.OTEL_LOGS_EXPORTER = "none";
	}
	try {
		sdk.start();
	} finally {
		if (logsExporter === undefined) {
			delete process.env.OTEL_LOGS_EXPORTER;
		} else {
			process.env.OTEL_LOGS_EXPORTER = logsExporter;
		}
	}
};

// A URL may carry credentials, so the warning names only its origin and path.
const endpointOpen = (value: string): string => {
	try {
		const url = new URL(value);
		return `${url.origin}${url.pathname}`;
	} catch {
		return "the OTLP endpoint";
	}
};

const endpointRead = (): string =>
	endpointOpen(
		[
			"OTEL_EXPORTER_OTLP_ENDPOINT",
			"OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
			"OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
			"OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
		]
			.map((name) => process.env[name]?.trim() ?? "")
			.find((value) => value !== "") ?? "",
	);

// Flushes and stops every signal; last in the shutdown resources. The final export is bounded by
// the exporter timeout (1 s by default, see above). If an export failed or timed out, shutdown
// still resolves, with one warning naming the endpoint. It never throws.
export const telemetryShutdown = async (): Promise<void> => {
	const started = sdk;
	sdk = undefined;
	if (started === undefined) {
		return;
	}
	exportFailed = false;
	const shutDown = await started.shutdown().then(
		() => true,
		() => false,
	);
	if (!shutDown || exportFailed) {
		process.emitWarning(
			`Telemetry: the final export to ${endpointRead()} failed or timed out; unsent telemetry was dropped.`,
		);
	}
};
