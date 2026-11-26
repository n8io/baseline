import { err, ok } from "@n8io/baseline-result";
import { context, type Meter, metrics, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
	InMemorySpanExporter,
	SimpleSpanProcessor,
	TracerProvider,
} from "@opentelemetry/sdk-trace";
import { beforeEach, describe, expect, it } from "vitest";
import { queueJobRun } from "./queue-job-run.ts";
import { queueLoggerTestRecord } from "./queue-logger-test-record.ts";

// What the telemetry preload registers in every process: a context manager and a tracer provider
// that keeps its spans, and a hand-written meter provider that records each counter increment.
const spanExporter = new InMemorySpanExporter();
context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
trace.setGlobalTracerProvider(
	new TracerProvider({
		spanProcessors: [new SimpleSpanProcessor({ exporter: spanExporter })],
	}),
);
const increments: { attributes: unknown; value: number }[] = [];
metrics.setGlobalMeterProvider({
	getMeter: () =>
		({
			createCounter: () => ({
				add: (value: number, attributes: unknown) => {
					increments.push({ attributes, value });
				},
			}),
		}) as unknown as Meter,
});

beforeEach(() => {
	spanExporter.reset();
	increments.length = 0;
});

describe("queueJobRun", () => {
	it("completes on ok", async () => {
		await expect(
			queueJobRun({
				queueName: "billing.foo-created",
				job: { retryCount: 0 },
				work: async () => ok(1),
			}),
		).resolves.toBeUndefined();
	});

	it("completes on err and marks the span with error.type", async () => {
		await trace.getTracer("test").startActiveSpan("job", async (span) => {
			await expect(
				queueJobRun({
					queueName: "billing.foo-created",
					job: { retryCount: 0 },
					work: async () => err({ type: "FooNotFound" }),
				}),
			).resolves.toBeUndefined();
			span.end();
		});

		expect(
			spanExporter.getFinishedSpans().map((span) => span.attributes),
		).toEqual([{ "error.type": "FooNotFound" }]);
	});

	it("rethrows, and counts a dead letter only on the last attempt", async () => {
		using _error = queueLoggerTestRecord("error");
		const boom = async (): Promise<never> => {
			throw new Error("boom");
		};

		await expect(
			queueJobRun({
				queueName: "billing.foo-created",
				job: { retryCount: 3 },
				work: boom,
			}),
		).rejects.toThrow("boom");
		expect(increments).toEqual([]);
		await expect(
			queueJobRun({
				queueName: "billing.foo-created",
				job: { retryCount: 4 },
				work: boom,
			}),
		).rejects.toThrow("boom");
		expect(increments).toEqual([
			{
				attributes: { "messaging.destination.name": "billing.foo-created" },
				value: 1,
			},
		]);
	});
	it("logs that the key is blocked when a Consumer's job fails for good", async () => {
		using error = queueLoggerTestRecord("error");
		const boom = async (): Promise<never> => {
			throw new Error("boom");
		};

		await expect(
			queueJobRun({
				queueName: "billing.foo-created",
				job: { key: "foo_1", retryCount: 4 },
				work: boom,
			}),
		).rejects.toThrow("boom");
		expect(error.calls.at(-1)).toEqual([
			expect.objectContaining({ attempt: 5, key: "foo_1" }),
			"Job failed; copied to dead letter, and its key is blocked until released",
		]);
		await expect(
			queueJobRun({
				queueName: "billing.foo-created",
				job: { key: "foo_1", retryCount: 0 },
				work: boom,
			}),
		).rejects.toThrow("boom");
		expect(error.calls.at(-1)).toEqual([
			expect.not.objectContaining({ key: "foo_1" }),
			"Job failed; will retry",
		]);
	});
});
