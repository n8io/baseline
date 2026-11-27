import type { LoggerErr } from "@n8io/baseline-logger/err-serialize";
import { Scope } from "@sentry/core";
import { describe, expect, it } from "vitest";
import {
	errorTrackingReportEventCreate,
	errorTrackingReportScopeTrace,
	errorTrackingReportTagsCreate,
} from "./error-tracking-report.ts";

const errOf = (fields: Record<string, unknown>) =>
	({ type: "Error", ...fields }) as LoggerErr;

describe("errorTrackingReportTagsCreate", () => {
	it.each([
		[{}, {}],
		[{ code: "23505" }, { "error.code": "23505" }],
		[{ constraint: "k" }, { "error.constraint": "k" }],
		[
			{ code: "1", constraint: "k" },
			{ "error.code": "1", "error.constraint": "k" },
		],
	])("tags %j as %j", (fields, tags) => {
		expect(errorTrackingReportTagsCreate(errOf(fields))).toStrictEqual(tags);
	});
});

describe("errorTrackingReportEventCreate", () => {
	it("builds an error-level event with exceptions and tags", () => {
		const event = errorTrackingReportEventCreate(errOf({ code: "1" }));

		expect(event.level).toBe("error");
		expect(event.tags).toEqual({ "error.code": "1" });
		expect(event.exception?.values?.map((v) => v.type)).toEqual(["Error"]);
	});
});

describe("errorTrackingReportScopeTrace", () => {
	it("sets the trace id tag and propagation context", () => {
		const scope = new Scope();

		errorTrackingReportScopeTrace(scope, {
			spanId: "b".repeat(16),
			traceId: "a".repeat(32),
		});

		expect(scope.getScopeData().tags).toEqual({ trace_id: "a".repeat(32) });
		expect(scope.getPropagationContext()).toMatchObject({
			propagationSpanId: "b".repeat(16),
			traceId: "a".repeat(32),
		});
	});

	it("leaves the scope alone without a span", () => {
		const scope = new Scope();
		const before = scope.getPropagationContext();

		errorTrackingReportScopeTrace(scope, undefined);

		expect(scope.getScopeData().tags).toEqual({});
		expect(scope.getPropagationContext()).toBe(before);
	});
});
