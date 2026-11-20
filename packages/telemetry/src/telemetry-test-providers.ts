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
	telemetryCleanupLogRecordProcessorCreate,
	telemetryCleanupSpanProcessorCreate,
} from "./telemetry-cleanup.ts";

// Global providers with in-memory exporters, the cleanup processors first,
// as the preload wires them.
export const telemetryTestSpans: InMemorySpanExporter =
	new InMemorySpanExporter();
export const telemetryTestLogRecords: InMemoryLogRecordExporter =
	new InMemoryLogRecordExporter();
export const telemetryTestMetricExporter: InMemoryMetricExporter =
	new InMemoryMetricExporter(AggregationTemporality.DELTA);
export const telemetryTestMetricReader: PeriodicExportingMetricReader =
	new PeriodicExportingMetricReader({
		exporter: telemetryTestMetricExporter,
		exportIntervalMillis: 60_000,
	});

context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
trace.setGlobalTracerProvider(
	new TracerProvider({
		spanProcessors: [
			telemetryCleanupSpanProcessorCreate(),
			new SimpleSpanProcessor({ exporter: telemetryTestSpans }),
		],
	}),
);
metrics.setGlobalMeterProvider(
	new MeterProvider({ readers: [telemetryTestMetricReader] }),
);
logs.setGlobalLoggerProvider(
	new LoggerProvider({
		processors: [
			telemetryCleanupLogRecordProcessorCreate(),
			new SimpleLogRecordProcessor({ exporter: telemetryTestLogRecords }),
		],
	}),
);
