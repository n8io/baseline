import { SpanStatusCode, trace } from "@opentelemetry/api";
import { beforeEach, describe, expect, it } from "vitest";
import {
	telemetrySpanAttributesSet,
	telemetrySpanRun,
} from "./telemetry-span.ts";
import { spans } from "./telemetry-test-providers.ts";

beforeEach(() => {
	spans.reset();
});

describe("telemetrySpanAttributesSet", () => {
	it("sets the attributes on the active span", async () => {
		await trace.getTracer("test").startActiveSpan("fooGet", async (span) => {
			telemetrySpanAttributesSet({ "baseline.foo.id": "foo_1" });
			span.end();
		});
		expect(spans.getFinishedSpans()[0]?.attributes).toEqual({
			"baseline.foo.id": "foo_1",
		});
	});

	it("does nothing without an active span", () => {
		expect(() =>
			telemetrySpanAttributesSet({ "baseline.foo.id": "foo_1" }),
		).not.toThrow();
		expect(spans.getFinishedSpans()).toEqual([]);
	});
});

describe("telemetrySpanRun", () => {
	it("runs the work in a child span that takes the attributes set inside", async () => {
		const count = await trace
			.getTracer("test")
			.startActiveSpan("fooImport", async (parent) => {
				const rows = await telemetrySpanRun("fooImport parse", () => {
					telemetrySpanAttributesSet({ "baseline.foo.row_count": 2 });
					return 2;
				});
				parent.end();
				return rows;
			});
		expect(count).toBe(2);
		const [child, parent] = spans.getFinishedSpans();
		expect(child?.name).toBe("fooImport parse");
		expect(child?.attributes).toEqual({ "baseline.foo.row_count": 2 });
		expect(child?.parentSpanContext?.spanId).toBe(parent?.spanContext().spanId);
		expect(child?.status.code).toBe(SpanStatusCode.UNSET);
	});

	it("sets status Error on a throw and rethrows it", async () => {
		await expect(
			telemetrySpanRun("fooImport parse", () => {
				throw new Error("bad file");
			}),
		).rejects.toThrow("bad file");
		expect(spans.getFinishedSpans()[0]?.status.code).toBe(SpanStatusCode.ERROR);
	});
});
