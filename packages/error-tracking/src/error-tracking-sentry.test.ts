import { logger } from "@n8io/baseline-logger";
import { context, TraceFlags, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorTrackingSentryCreate } from "./error-tracking-sentry.ts";

context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());

const canary = "canary@example.com";
const dsn = "https://public@o1.ingest.sentry.io/1";

type SentEvent = {
	contexts?: { trace?: { span_id?: string; trace_id?: string } };
	environment?: string;
	exception?: {
		values?: { type?: string; value?: string; stacktrace?: object }[];
	};
	message?: string;
	tags?: Record<string, string>;
};

// Stands in for Sentry's ingestion: keeps each event the client sends.
const transportCatch = () => {
	const events: SentEvent[] = [];
	const transport = () => ({
		flush: async () => true,
		send: async (envelope: unknown) => {
			const [, items] = envelope as [unknown, [{ type: string }, unknown][]];
			for (const [header, payload] of items) {
				if (header.type === "event") events.push(payload as SentEvent);
			}
			return {};
		},
	});
	return { events, transport };
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("errorTrackingSentryCreate", () => {
	it("reports the class name, stack and cause chain, never a message", async () => {
		const { events, transport } = transportCatch();
		const errorTracking = errorTrackingSentryCreate({
			dsn,
			environment: "test",
			vendor: { transport },
		});

		errorTracking.report(
			new Error(`failed for ${canary}`, {
				cause: new TypeError(`bad input ${canary}`),
			}),
		);
		await errorTracking.close();

		expect(events).toHaveLength(1);
		expect(events[0]?.environment).toBe("test");
		expect(events[0]?.exception?.values?.map((v) => v.type)).toEqual([
			"TypeError",
			"Error",
		]);
		expect(events[0]?.exception?.values?.[1]?.stacktrace).toBeDefined();
		expect(JSON.stringify(events)).not.toContain(canary);
	});

	it("reports a thrown value that is not an Error without its text", async () => {
		const { events, transport } = transportCatch();
		const errorTracking = errorTrackingSentryCreate({
			dsn,
			environment: "test",
			vendor: { transport },
		});

		errorTracking.report(`thrown ${canary}`);
		errorTracking.report({ email: canary });
		await errorTracking.close();

		expect(events).toHaveLength(2);
		expect(JSON.stringify(events)).not.toContain(canary);
	});

	it("links the report to the active trace", async () => {
		const { events, transport } = transportCatch();
		const errorTracking = errorTrackingSentryCreate({
			dsn,
			environment: "test",
			vendor: { transport },
		});
		const spanContext = {
			spanId: "b7ad6b7169203331",
			traceFlags: TraceFlags.SAMPLED,
			traceId: "0af7651916cd43dd8448eb211c80319c",
		};

		context.with(
			trace.setSpan(context.active(), trace.wrapSpanContext(spanContext)),
			() => errorTracking.report(new Error("boom")),
		);
		await errorTracking.close();

		expect(events[0]?.contexts?.trace).toMatchObject({
			span_id: spanContext.spanId,
			trace_id: spanContext.traceId,
		});
		expect(events[0]?.tags?.trace_id).toBe(spanContext.traceId);
	});

	it("sends nothing after close", async () => {
		const { events, transport } = transportCatch();
		const errorTracking = errorTrackingSentryCreate({
			dsn,
			environment: "test",
			vendor: { transport },
		});

		await errorTracking.close();
		errorTracking.report(new Error("late"));
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(events).toEqual([]);
	});

	it("warns when the reports in flight do not finish before close gives up", async () => {
		vi.useFakeTimers();
		const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
		const errorTracking = errorTrackingSentryCreate({
			dsn,
			environment: "test",
			vendor: {
				// Never answers; flush gives up at its timeout, as Sentry's own transport does.
				transport: () => ({
					flush: (timeout?: number) =>
						new Promise<boolean>((resolve) => {
							setTimeout(() => resolve(false), timeout);
						}),
					send: () => new Promise(() => undefined),
				}),
			},
		});

		errorTracking.report(new Error("stuck"));
		const closing = errorTracking.close();
		await vi.advanceTimersByTimeAsync(5000);
		await closing;
		vi.useRealTimers();

		expect(warn).toHaveBeenCalledWith("Error reports still unsent at close");
	});

	it.each([
		"beforeSend",
		"dataCollection",
		"dsn",
		"enableOpenTelemetrySetup",
		"enableRuntimeChannelInjection",
		"includeLocalVariables",
		"integrations",
		"stackParser",
	])("refuses vendor.%s", (key) => {
		expect(() =>
			errorTrackingSentryCreate({
				dsn,
				environment: "test",
				vendor: { [key]: true } as never,
			}),
		).toThrow(new RegExp(`vendor\\.${key} is not allowed`));
	});
});
