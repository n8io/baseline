import { logs, SpanStatusCode, trace } from "@opentelemetry/api";
import { beforeEach, describe, expect, it } from "vitest";
import {
	telemetryCleanupLogRecordProcessorCreate,
	telemetryCleanupQueryRedact,
	telemetryCleanupSpanProcessorCreate,
} from "./telemetry-cleanup.ts";
import {
	telemetryTestLogRecords,
	telemetryTestSpans,
} from "./telemetry-test-providers.ts";

const canary = "jane@example.com";

// A stack whose message spans two lines, as drizzle's DrizzleQueryError does.
const stack = [
	`DrizzleQueryError: Failed query: insert into foo values ($1)`,
	`params: ${canary}`,
	"    at fooRepositoryPostgresCreate.insert (foo-repository.postgres.ts:41:7)",
	"    at fooCreate (foo-create.ts:12:3)",
].join("\n");
const message = `Failed query: insert into foo values ($1)\nparams: ${canary}`;
const frames = [
	"at fooRepositoryPostgresCreate.insert (foo-repository.postgres.ts:41:7)",
	"at fooCreate (foo-create.ts:12:3)",
].join("\n");

beforeEach(() => {
	telemetryTestSpans.reset();
	telemetryTestLogRecords.reset();
});

describe("telemetryCleanupQueryRedact", () => {
	it("replaces every value and keeps every key", () => {
		expect(
			telemetryCleanupQueryRedact(`email=${canary}&page=2&flag&empty=`),
		).toBe("email=REDACTED&page=REDACTED&flag&empty=REDACTED");
	});
});

describe("span cleanup", () => {
	it("turns an error status description into error.type", () => {
		const span = trace.getTracer("test").startSpan("pg.query");
		span.setAttribute("error.type", "23505");
		span.setStatus({
			code: SpanStatusCode.ERROR,
			message: `duplicate ${canary}`,
		});
		span.end();
		expect(telemetryTestSpans.getFinishedSpans()[0]?.status).toEqual({
			code: SpanStatusCode.ERROR,
			message: "23505",
		});
	});

	it("uses Error when the span has no error.type, and keeps a status without text", () => {
		const tracer = trace.getTracer("test");
		const withText = tracer.startSpan("a");
		withText.setStatus({ code: SpanStatusCode.ERROR, message: canary });
		withText.end();
		const withoutText = tracer.startSpan("b");
		withoutText.setStatus({ code: SpanStatusCode.ERROR });
		withoutText.end();
		expect(
			telemetryTestSpans.getFinishedSpans().map((span) => span.status),
		).toEqual([
			{ code: SpanStatusCode.ERROR, message: "Error" },
			{ code: SpanStatusCode.ERROR },
		]);
	});

	it("replaces query values in url.query and url.full and keeps url.path", () => {
		const span = trace.getTracer("test").startSpan("GET");
		span.setAttributes({
			"url.full": `https://api.example.com/foos?email=${canary}&page=2#top`,
			"url.path": "/foos",
			"url.query": `email=${canary}&page=2`,
		});
		span.end();
		expect(telemetryTestSpans.getFinishedSpans()[0]?.attributes).toEqual({
			"url.full":
				"https://api.example.com/foos?email=REDACTED&page=REDACTED#top",
			"url.path": "/foos",
			"url.query": "email=REDACTED&page=REDACTED",
		});
	});

	it("keeps only type and stack frames on exception events", () => {
		const span = trace.getTracer("test").startSpan("fetch");
		const error = new Error(message);
		error.name = "DrizzleQueryError";
		error.stack = stack;
		span.recordException(error);
		span.end();
		expect(
			telemetryTestSpans.getFinishedSpans()[0]?.events[0]?.attributes,
		).toEqual({
			"exception.stacktrace": frames,
			"exception.type": "DrizzleQueryError",
		});
	});
});

describe("span cleanup edge cases", () => {
	it("keeps a url.full without a query, and one whose query has no fragment", () => {
		const tracer = trace.getTracer("test");
		const plain = tracer.startSpan("a");
		plain.setAttribute("url.full", "https://api.example.com/a=b/foos#top");
		plain.end();
		const queried = tracer.startSpan("b");
		queried.setAttribute("url.full", "https://api.example.com/foos?page=2");
		queried.end();
		expect(
			telemetryTestSpans
				.getFinishedSpans()
				.map((span) => span.attributes["url.full"]),
		).toEqual([
			"https://api.example.com/a=b/foos#top",
			"https://api.example.com/foos?page=REDACTED",
		]);
	});

	it("keeps an empty stack when the exception has no frames", () => {
		const span = trace.getTracer("test").startSpan("a");
		span.addEvent("exception", {
			"exception.message": "boom",
			"exception.stacktrace": "Error: boom",
		});
		span.end();
		expect(
			telemetryTestSpans.getFinishedSpans()[0]?.events[0]?.attributes,
		).toEqual({ "exception.stacktrace": "" });
	});

	it("leaves an OK status as it is", () => {
		const span = trace.getTracer("test").startSpan("ok");
		span.setStatus({ code: SpanStatusCode.OK });
		span.end();
		expect(telemetryTestSpans.getFinishedSpans()[0]?.status).toEqual({
			code: SpanStatusCode.OK,
		});
	});

	it("leaves events other than exception as they are", () => {
		const span = trace.getTracer("test").startSpan("a");
		span.addEvent("note", { "exception.message": canary });
		span.end();
		expect(
			telemetryTestSpans.getFinishedSpans()[0]?.events[0]?.attributes,
		).toEqual({ "exception.message": canary });
	});

	it("does not fail on an exception event without attributes", () => {
		const span = trace.getTracer("test").startSpan("a");
		span.addEvent("exception");
		expect(() => span.end()).not.toThrow();
		expect(telemetryTestSpans.getFinishedSpans()[0]?.events[0]?.name).toBe(
			"exception",
		);
	});

	it("cuts a frame-shaped line out of the message, and keeps a frame that holds the message's digits", () => {
		const tracer = trace.getTracer("test");
		const leaked = tracer.startSpan("a");
		leaked.addEvent("exception", {
			"exception.message": "boom\n    at leaked (secret.ts:1:1)",
			"exception.stacktrace": [
				"Error: boom",
				"    at leaked (secret.ts:1:1)",
				"    at real (app.ts:2:2)",
			].join("\n"),
		});
		leaked.end();
		const numeric = tracer.startSpan("b");
		numeric.addEvent("exception", {
			"exception.message": 42,
			"exception.stacktrace": "Error\n    at fn42 (app.ts:3:3)",
		});
		numeric.end();
		const [first, second] = telemetryTestSpans.getFinishedSpans();
		expect(first?.events[0]?.attributes).toEqual({
			"exception.stacktrace": "at real (app.ts:2:2)",
		});
		expect(second?.events[0]?.attributes).toEqual({
			"exception.stacktrace": "at fn42 (app.ts:3:3)",
		});
	});
});

describe("processor lifecycle", () => {
	it("resolves forceFlush and shutdown on both processors", async () => {
		const spans = telemetryCleanupSpanProcessorCreate();
		const records = telemetryCleanupLogRecordProcessorCreate();
		await expect(spans.forceFlush()).resolves.toBeUndefined();
		await expect(spans.shutdown()).resolves.toBeUndefined();
		await expect(records.forceFlush()).resolves.toBeUndefined();
		await expect(records.shutdown()).resolves.toBeUndefined();
	});
});

describe("log record cleanup", () => {
	it("keeps only type and stack frames on exception log records", () => {
		const error = new Error(message);
		error.name = "DrizzleQueryError";
		error.stack = stack;
		logs.getLogger("test").emit({ body: message, exception: error });
		const [record] = telemetryTestLogRecords.getFinishedLogRecords();
		expect(record?.attributes).toEqual({
			"exception.stacktrace": frames,
			"exception.type": "DrizzleQueryError",
		});
		expect(record?.body).toBe("DrizzleQueryError");
	});

	it("names the body Error when the exception has no type", () => {
		logs
			.getLogger("test")
			.emit({ attributes: { "exception.message": canary }, body: canary });
		const [record] = telemetryTestLogRecords.getFinishedLogRecords();
		expect(record?.body).toBe("Error");
		expect(record?.attributes).toEqual({});
	});

	it("keeps a body that is not the exception message", () => {
		logs.getLogger("test").emit({
			attributes: { "exception.message": canary },
			body: "request failed",
		});
		const [record] = telemetryTestLogRecords.getFinishedLogRecords();
		expect(record?.body).toBe("request failed");
		expect(record?.attributes).toEqual({});
	});

	it("leaves a record with no body and no exception without a body", () => {
		logs.getLogger("test").emit({ attributes: { route: "/foos" } });
		const [record] = telemetryTestLogRecords.getFinishedLogRecords();
		expect(record?.body).toBeUndefined();
	});

	it("leaves a record without an exception as it is", () => {
		logs
			.getLogger("test")
			.emit({ attributes: { route: "/foos" }, body: "request done" });
		const [record] = telemetryTestLogRecords.getFinishedLogRecords();
		expect(record?.attributes).toEqual({ route: "/foos" });
		expect(record?.body).toBe("request done");
	});
});
