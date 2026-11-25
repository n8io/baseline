import { trace } from "@opentelemetry/api";
import { beforeEach, describe, expect, it } from "vitest";
import { telemetryFeatureFlagEvaluationRecord } from "./telemetry-feature-flag.ts";
import {
	telemetryTestLogRecords,
	telemetryTestSpans,
} from "./telemetry-test-providers.ts";

beforeEach(() => {
	telemetryTestLogRecords.reset();
	telemetryTestSpans.reset();
});

const recordsGet = () => telemetryTestLogRecords.getFinishedLogRecords();

describe("telemetryFeatureFlagEvaluationRecord", () => {
	it("emits a feature_flag.evaluation log record with the convention's attributes", () => {
		telemetryFeatureFlagEvaluationRecord({
			key: "checkout-redesign",
			providerName: "launchdarkly",
			reason: "targeting_match",
			value: true,
		});
		const [record] = recordsGet();
		expect(record?.eventName).toBe("feature_flag.evaluation");
		expect(record?.attributes).toEqual({
			"feature_flag.key": "checkout-redesign",
			"feature_flag.provider.name": "launchdarkly",
			"feature_flag.result.reason": "targeting_match",
			"feature_flag.result.value": true,
		});
	});

	it("records the variant and not the value when the service gave a variant", () => {
		telemetryFeatureFlagEvaluationRecord({
			key: "hero-copy",
			value: "long copy",
			variant: "b",
		});
		expect(recordsGet()[0]?.attributes).toEqual({
			"feature_flag.key": "hero-copy",
			"feature_flag.result.variant": "b",
		});
	});

	it("never records an object or a string as the value", () => {
		telemetryFeatureFlagEvaluationRecord({ key: "a", value: { big: true } });
		telemetryFeatureFlagEvaluationRecord({
			key: "b",
			value: "jane@example.com",
		});
		expect(recordsGet().map((record) => record.attributes)).toEqual([
			{ "feature_flag.key": "a" },
			{ "feature_flag.key": "b" },
		]);
	});

	it("sets error.type on a failure", () => {
		telemetryFeatureFlagEvaluationRecord({
			errorType: "flag_not_found",
			key: "gone",
			reason: "error",
		});
		expect(recordsGet()[0]?.attributes).toMatchObject({
			"error.type": "flag_not_found",
			"feature_flag.result.reason": "error",
		});
	});

	it("carries the active trace and leaves the span without events or child spans", async () => {
		await trace.getTracer("test").startActiveSpan("fooGet", async (span) => {
			telemetryFeatureFlagEvaluationRecord({ key: "a", value: 1 });
			span.end();
		});
		const [span] = telemetryTestSpans.getFinishedSpans();
		expect(telemetryTestSpans.getFinishedSpans()).toHaveLength(1);
		expect(span?.events).toEqual([]);
		expect(recordsGet()[0]?.spanContext?.traceId).toBe(
			span?.spanContext().traceId,
		);
	});
});
