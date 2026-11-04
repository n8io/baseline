import { err, ok, type Result } from "@n8io/baseline-result";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import type { HistogramMetricData } from "@opentelemetry/sdk-metrics";
import { beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import {
	metricExporter,
	metricReader,
	spans,
} from "./telemetry-test-providers.ts";
import { telemetryUseCasesTrace } from "./telemetry-use-cases-trace.ts";

class FooNameTaken extends Error {
	readonly type = "FooNameTaken";
}

class FooStoreDown extends Error {}

const fooUseCases = {
	fooCreate: async (input: {
		name: string;
	}): Promise<Result<{ name: string }, FooNameTaken>> =>
		input.name === "taken"
			? err(new FooNameTaken(input.name))
			: ok({ name: input.name }),
	fooDelete: async (_input: {
		fooId: string;
	}): Promise<Result<void, FooNameTaken>> => {
		throw new FooStoreDown("connection to secret-host failed");
	},
};

const durationPoints = async () => {
	await metricReader.forceFlush();
	const metric = metricExporter
		.getMetrics()
		.at(-1)
		?.scopeMetrics.flatMap((scope) => scope.metrics)
		.find((item) => item.descriptor.name === "baseline.use_case.duration") as
		| HistogramMetricData
		| undefined;
	return metric;
};

beforeEach(async () => {
	spans.reset();
	await metricReader.forceFlush();
	metricExporter.reset();
});

describe("telemetryUseCasesTrace", () => {
	it("keeps each use case's name and type", async () => {
		const traced = telemetryUseCasesTrace(fooUseCases);
		expectTypeOf(traced).toEqualTypeOf(fooUseCases);
		expect(Object.keys(traced)).toEqual(["fooCreate", "fooDelete"]);
		expect(await traced.fooCreate({ name: "a" })).toEqual(ok({ name: "a" }));
	});

	it("records an ok call as one INTERNAL span with status Unset", async () => {
		await telemetryUseCasesTrace(fooUseCases).fooCreate({ name: "a" });
		const [span, ...rest] = spans.getFinishedSpans();
		expect(rest).toEqual([]);
		expect(span?.name).toBe("fooCreate");
		expect(span?.kind).toBe(SpanKind.INTERNAL);
		expect(span?.attributes).toEqual({ "code.function.name": "fooCreate" });
		expect(span?.status.code).toBe(SpanStatusCode.UNSET);
	});

	it("puts an err result's type on error.type and leaves status Unset", async () => {
		const result = await telemetryUseCasesTrace(fooUseCases).fooCreate({
			name: "taken",
		});
		expect(result.ok).toBe(false);
		const [span] = spans.getFinishedSpans();
		expect(span?.attributes).toEqual({
			"code.function.name": "fooCreate",
			"error.type": "FooNameTaken",
		});
		expect(span?.status.code).toBe(SpanStatusCode.UNSET);
		expect(span?.events).toEqual([]);
	});

	it("marks a throw with the class name only and rethrows it", async () => {
		const traced = telemetryUseCasesTrace(fooUseCases);
		await expect(traced.fooDelete({ fooId: "foo_1" })).rejects.toBeInstanceOf(
			FooStoreDown,
		);
		const [span] = spans.getFinishedSpans();
		expect(span?.attributes["error.type"]).toBe("FooStoreDown");
		expect(span?.status).toEqual({
			code: SpanStatusCode.ERROR,
			message: "FooStoreDown",
		});
		expect(span?.events).toEqual([]);
		expect(JSON.stringify(span?.attributes)).not.toContain("secret-host");
	});

	it("records baseline.use_case.duration in seconds per outcome", async () => {
		const traced = telemetryUseCasesTrace(fooUseCases);
		await traced.fooCreate({ name: "a" });
		await traced.fooCreate({ name: "taken" });
		await traced.fooDelete({ fooId: "foo_1" }).catch(() => undefined);
		const metric = await durationPoints();
		expect(metric?.descriptor.unit).toBe("s");
		const points = metric?.dataPoints.map((point) => ({
			attributes: point.attributes,
			count: point.value.count,
		}));
		expect(points).toEqual([
			{ attributes: { "code.function.name": "fooCreate" }, count: 1 },
			{
				attributes: {
					"code.function.name": "fooCreate",
					"error.type": "FooNameTaken",
				},
				count: 1,
			},
			{
				attributes: {
					"code.function.name": "fooDelete",
					"error.type": "FooStoreDown",
				},
				count: 1,
			},
		]);
		expect(metric?.dataPoints[0]?.value.sum).toBeLessThan(1);
	});
});
