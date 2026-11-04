import { context, logs, metrics, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
	InMemoryLogRecordExporter,
	LoggerProvider,
	SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
	AggregationTemporality,
	InMemoryMetricExporter,
	MeterProvider,
	PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
	InMemorySpanExporter,
	SimpleSpanProcessor,
	TracerProvider,
} from "@opentelemetry/sdk-trace";
import {
	telemetryLogRecordCleanup,
	telemetrySpanCleanup,
} from "./telemetry-cleanup.ts";

// Global providers with in-memory exporters, the cleanup processors first,
// as the preload wires them.
export const spans: InMemorySpanExporter = new InMemorySpanExporter();
export const logRecords: InMemoryLogRecordExporter =
	new InMemoryLogRecordExporter();
export const metricExporter: InMemoryMetricExporter =
	new InMemoryMetricExporter(AggregationTemporality.DELTA);
export const metricReader: PeriodicExportingMetricReader =
	new PeriodicExportingMetricReader({
		exporter: metricExporter,
		exportIntervalMillis: 60_000,
	});

context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
trace.setGlobalTracerProvider(
	new TracerProvider({
		spanProcessors: [
			telemetrySpanCleanup(),
			new SimpleSpanProcessor({ exporter: spans }),
		],
	}),
);
metrics.setGlobalMeterProvider(new MeterProvider({ readers: [metricReader] }));
logs.setGlobalLoggerProvider(
	new LoggerProvider({
		processors: [
			telemetryLogRecordCleanup(),
			new SimpleLogRecordProcessor({ exporter: logRecords }),
		],
	}),
);
