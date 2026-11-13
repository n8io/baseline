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
		values?: {
			type?: string;
			value?: string;
			stacktrace?: { frames?: { function?: string }[] };
		}[];
	};
	release?: string;
	tags?: Record<string, string>;
};

// Stands in for Sentry's ingestion: keeps each envelope, and answers with `status`.
const requestsCatch = (status = 200) => {
	const requests: {
		url: string;
		header: { trace?: { trace_id?: string } };
		event: SentEvent;
	}[] = [];
	vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
		const [header, , event] = String(init.body).split("\n");
		requests.push({
			event: JSON.parse(event ?? "{}") as SentEvent,
			header: JSON.parse(header ?? "{}"),
			url,
		});
		return new Response("{}", { status });
	});
	return requests;
};

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("errorTrackingSentryCreate", () => {
	it("posts the report to the DSN's project with the class names, stacks and causes", async () => {
		const requests = requestsCatch();
		const errorTracking = errorTrackingSentryCreate({
			dsn,
			environment: "test",
		});

		const error = new Error("boom", { cause: new TypeError("inner") });
		errorTracking.report(error);
		await errorTracking.close();

		expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
			"/api/1/envelope/",
		]);
		const event: SentEvent = requests[0]?.event ?? {};
		expect(event.environment).toBe("test");
		expect(event.exception?.values?.map((v) => v.type)).toEqual([
			"TypeError",
			"Error",
		]);
		expect(
			event.exception?.values?.[1]?.stacktrace?.frames?.length,
		).toBeGreaterThan(0);
		expect(Object.keys(error)).toEqual([]);
	});

	it("never sends message text, even in a name or a frame-shaped message line", async () => {
		const requests = requestsCatch();
		const errorTracking = errorTrackingSentryCreate({
			dsn,
			environment: "test",
		});
		const named = new Error(`failed for ${canary}`);
		named.name = `Name ${canary}`;

		errorTracking.report(named);
		errorTracking.report(new Error(`one\n    at fake (${canary}.js:1:1)`));
		errorTracking.report(
			new Error("outer", { cause: new TypeError(`bad input ${canary}`) }),
		);
		errorTracking.report(`thrown ${canary}`);
		errorTracking.report({ email: canary });
		errorTracking.report(new AggregateError([new Error(canary)], canary));
		await errorTracking.close();

		expect(requests).toHaveLength(6);
		expect(JSON.stringify(requests)).not.toContain(canary);
		expect(
			requests.map((r) => r.event.exception?.values?.at(-1)?.type),
		).toEqual([
			"Error",
			"Error",
			"Error",
			"string",
			"object",
			"AggregateError",
		]);
		expect(JSON.stringify(requests)).not.toMatch(/server_name|"os"|"device"/);
	});

	it("tags the error's code and constraint", async () => {
		const requests = requestsCatch();
		const errorTracking = errorTrackingSentryCreate({
			dsn,
			environment: "test",
		});

		errorTracking.report(
			Object.assign(new Error("duplicate key"), {
				code: "23505",
				constraint: "foo_name_key",
			}),
		);
		await errorTracking.close();

		expect(requests[0]?.event.tags).toMatchObject({
			"error.code": "23505",
			"error.constraint": "foo_name_key",
		});
	});

	it("links the report to the active trace", async () => {
		const requests = requestsCatch();
		const errorTracking = errorTrackingSentryCreate({
			dsn,
			environment: "test",
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

		expect(requests[0]?.event.contexts?.trace).toMatchObject({
			span_id: spanContext.spanId,
			trace_id: spanContext.traceId,
		});
		expect(requests[0]?.header.trace?.trace_id).toBe(spanContext.traceId);
		expect(requests[0]?.event.tags?.trace_id).toBe(spanContext.traceId);
	});

	it("passes vendor.release through", async () => {
		const requests = requestsCatch();
		const errorTracking = errorTrackingSentryCreate({
			dsn,
			environment: "test",
			vendor: { release: "app@1.2.3" },
		});

		errorTracking.report(new Error("boom"));
		await errorTracking.close();

		expect(requests[0]?.event.release).toBe("app@1.2.3");
	});

	it("warns when Sentry refuses a report", async () => {
		requestsCatch(429);
		const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
		const errorTracking = errorTrackingSentryCreate({
			dsn,
			environment: "test",
		});

		errorTracking.report(new Error("boom"));
		await errorTracking.close();

		expect(warn).toHaveBeenCalledWith(
			{ status: 429 },
			"Sentry refused an error report",
		);
	});

	it("sends nothing after close", async () => {
		const requests = requestsCatch();
		const errorTracking = errorTrackingSentryCreate({
			dsn,
			environment: "test",
		});

		await errorTracking.close();
		errorTracking.report(new Error("late"));
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(requests).toEqual([]);
	});

	it("gives up at close when a send never finishes, and warns", async () => {
		vi.useFakeTimers();
		vi.stubGlobal("fetch", () => new Promise(() => undefined));
		const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
		const errorTracking = errorTrackingSentryCreate({
			dsn,
			environment: "test",
		});

		errorTracking.report(new Error("stuck"));
		const closing = errorTracking.close();
		await vi.advanceTimersByTimeAsync(5000);
		await closing;

		expect(warn).toHaveBeenCalledWith("Error reports still unsent at close");
	});

	it.each(["https://example.com", "garbage"])(
		"refuses dsn %j, which is not a Sentry DSN",
		(bad) => {
			expect(() =>
				errorTrackingSentryCreate({ dsn: bad, environment: "test" }),
			).toThrow(/dsn is not a Sentry DSN/);
		},
	);

	it.each(["beforeSend", "dsn", "integrations", "transport", "debug"])(
		"refuses vendor.%s",
		(key) => {
			expect(() =>
				errorTrackingSentryCreate({
					dsn,
					environment: "test",
					vendor: { [key]: true } as never,
				}),
			).toThrow(new RegExp(`vendor\\.${key} is not allowed`));
		},
	);
});
