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
// What the Package asked the meter provider for, kept across tests: it asks once, on first use.
const asked: { counter: unknown[][]; meter: string[] } = {
	counter: [],
	meter: [],
};
metrics.setGlobalMeterProvider({
	getMeter: (name: string) => {
		asked.meter.push(name);
		return {
			createCounter: (...args: unknown[]) => {
				asked.counter.push(args);
				return {
					add: (value: number, attributes: unknown) => {
						increments.push({ attributes, value });
					},
				};
			},
		} as unknown as Meter;
	},
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
		// It asks once, on the first dead letter, so this is the test that sees the request.
		expect(asked).toEqual({
			counter: [
				[
					"baseline.queue.dead_letters",
					{
						description:
							"Jobs moved to a dead-letter queue after their last attempt",
						unit: "{job}",
					},
				],
			],
			meter: ["@n8io/baseline-queue"],
		});
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

	it.each([{}, { key: null }])(
		"logs a plain dead letter for a job without a key: %o",
		async (key) => {
			using error = queueLoggerTestRecord("error");

			await expect(
				queueJobRun({
					queueName: "billing.foo-created",
					job: { ...key, retryCount: 4 },
					work: async () => {
						throw new Error("boom");
					},
				}),
			).rejects.toThrow("boom");

			expect(error.calls.at(-1)).toEqual([
				expect.not.objectContaining({ key: expect.anything() }),
				"Job failed; moved to dead letter",
			]);
		},
	);

	it("leaves the span alone on ok, and does not need one on err", async () => {
		await trace.getTracer("test").startActiveSpan("job", async (span) => {
			await queueJobRun({
				queueName: "billing.foo-created",
				job: { retryCount: 0 },
				work: async () => ok(1),
			});
			span.end();
		});
		await expect(
			queueJobRun({
				queueName: "billing.foo-created",
				job: { retryCount: 0 },
				work: async () => err({ type: "FooNotFound" }),
			}),
		).resolves.toBeUndefined();

		expect(
			spanExporter.getFinishedSpans().map((span) => span.attributes),
		).toEqual([{}]);
	});
});
