import { OTLPLogExporter as LogExporterGrpc } from "@opentelemetry/exporter-logs-otlp-grpc";
import { OTLPLogExporter as LogExporterHttp } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPLogExporter as LogExporterProto } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPTraceExporter as TraceExporterGrpc } from "@opentelemetry/exporter-trace-otlp-grpc";
import { OTLPTraceExporter as TraceExporterHttp } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPTraceExporter as TraceExporterProto } from "@opentelemetry/exporter-trace-otlp-proto";
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

// The OTEL_* settings NodeSDK reads only when it builds the processors itself.
// It builds them only when given none, and the cleanup processors must run
// first, so this file builds them the same way from the same variables.

const envList = (name: string): string[] =>
	(process.env[name] ?? "")
		.split(",")
		.map((item) => item.trim())
		.filter((item) => item !== "");

const exportersNamed = (name: string): string[] => {
	const names = envList(name);
	if (names.includes("none")) {
		return [];
	}
	return names.length === 0 ? ["otlp"] : names;
};

const protocol = (signal: "LOGS" | "TRACES"): string =>
	process.env[`OTEL_EXPORTER_OTLP_${signal}_PROTOCOL`]?.trim() ||
	process.env.OTEL_EXPORTER_OTLP_PROTOCOL?.trim() ||
	"http/protobuf";

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

const spanProcessorsFromEnv = (): SpanProcessor[] =>
	exportersNamed("OTEL_TRACES_EXPORTER").flatMap((name): SpanProcessor[] => {
		if (name === "console") {
			return [new SimpleSpanProcessor({ exporter: new ConsoleSpanExporter() })];
		}
		if (name !== "otlp") {
			return [];
		}
		const by = protocol("TRACES");
		const exporter =
			by === "grpc"
				? new TraceExporterGrpc()
				: by === "http/json"
					? new TraceExporterHttp()
					: new TraceExporterProto();
		return [new BatchSpanProcessor({ exporter, ...batchOptions("BSP") })];
	});

const logRecordProcessorsFromEnv = (): LogRecordProcessor[] =>
	exportersNamed("OTEL_LOGS_EXPORTER").flatMap((name): LogRecordProcessor[] => {
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
		const by = protocol("LOGS");
		const exporter =
			by === "grpc"
				? new LogExporterGrpc()
				: by === "http/json"
					? new LogExporterHttp()
					: new LogExporterProto();
		return [new BatchLogRecordProcessor({ exporter, ...batchOptions("BLRP") })];
	});

let sdk: NodeSDK | undefined;

export const telemetryStart = (): void => {
	if (sdk !== undefined) {
		return;
	}
	// Exceptions as log records, not span events; read when instrumentations
	// are built, so it is set first.
	process.env.OTEL_SEMCONV_EXCEPTION_SIGNAL_OPT_IN ??= "logs";
	const spanProcessors = spanProcessorsFromEnv();
	const logRecordProcessors = logRecordProcessorsFromEnv();
	sdk = new NodeSDK({
		instrumentations: [
			new HttpInstrumentation({
				ignoreIncomingRequestHook: (request) =>
					pathsHealth.has((request.url ?? "").split("?")[0] ?? ""),
			}),
			new UndiciInstrumentation(),
			new PgInstrumentation({ enhancedDatabaseReporting: false }),
			new RedisInstrumentation(),
			new PinoInstrumentation(),
			new RuntimeNodeInstrumentation(),
		],
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
	sdk.start();
};

// Flushes and stops every signal; last in the shutdown resources. A failed
// last export (no collector running) is dropped quietly, like every export.
export const telemetryShutdown = async (): Promise<void> => {
	const started = sdk;
	sdk = undefined;
	await started?.shutdown().catch(() => undefined);
};
