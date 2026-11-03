import { logs, SpanStatusCode, trace } from "@opentelemetry/api";
import { beforeEach, describe, expect, it } from "vitest";
import { telemetryQueryRedact } from "../src/telemetry-cleanup.ts";
import { logRecords, spans } from "./telemetry-test-providers.ts";

const canary = "jane@example.com";

// A stack whose message spans two lines, as drizzle's DrizzleQueryError does.
const stack = [
	`DrizzleQueryError: Failed query: insert into foo values ($1)`,
	`params: ${canary}`,
	"    at fooRepositoryPostgres.insert (foo-repository.postgres.ts:41:7)",
	"    at fooCreate (foo-create.ts:12:3)",
].join("\n");
const message = `Failed query: insert into foo values ($1)\nparams: ${canary}`;
const frames = [
	"at fooRepositoryPostgres.insert (foo-repository.postgres.ts:41:7)",
	"at fooCreate (foo-create.ts:12:3)",
].join("\n");

beforeEach(() => {
	spans.reset();
	logRecords.reset();
});

describe("telemetryQueryRedact", () => {
	it("replaces every value and keeps every key", () => {
		expect(telemetryQueryRedact(`email=${canary}&page=2&flag&empty=`)).toBe(
			"email=REDACTED&page=REDACTED&flag&empty=REDACTED",
		);
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
		expect(spans.getFinishedSpans()[0]?.status).toEqual({
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
		expect(spans.getFinishedSpans().map((span) => span.status)).toEqual([
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
		expect(spans.getFinishedSpans()[0]?.attributes).toEqual({
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
		expect(spans.getFinishedSpans()[0]?.events[0]?.attributes).toEqual({
			"exception.stacktrace": frames,
			"exception.type": "DrizzleQueryError",
		});
	});
});

describe("log record cleanup", () => {
	it("keeps only type and stack frames on exception log records", () => {
		const error = new Error(message);
		error.name = "DrizzleQueryError";
		error.stack = stack;
		logs.getLogger("test").emit({ body: message, exception: error });
		const [record] = logRecords.getFinishedLogRecords();
		expect(record?.attributes).toEqual({
			"exception.stacktrace": frames,
			"exception.type": "DrizzleQueryError",
		});
		expect(record?.body).toBe("DrizzleQueryError");
	});

	it("leaves a record without an exception as it is", () => {
		logs
			.getLogger("test")
			.emit({ attributes: { route: "/foos" }, body: "request done" });
		const [record] = logRecords.getFinishedLogRecords();
		expect(record?.attributes).toEqual({ route: "/foos" });
		expect(record?.body).toBe("request done");
	});
});
