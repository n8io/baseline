import { type LogRecord, logs } from "@opentelemetry/api";
import { beforeEach, describe, expect, it } from "vitest";
import { featureFlagsLaunchDarklyEvaluationRecord } from "./feature-flags-launch-darkly-evaluation.ts";

// A global logger provider that keeps every record, as the telemetry preload would export them.
const records: LogRecord[] = [];
logs.setGlobalLoggerProvider({
	getLogger: () => ({
		emit: (record: LogRecord) => records.push(record),
		enabled: () => true,
	}),
});

beforeEach(() => {
	records.length = 0;
});

describe("featureFlagsLaunchDarklyEvaluationRecord", () => {
	it("emits a feature_flag.evaluation log record with the convention's attributes", () => {
		featureFlagsLaunchDarklyEvaluationRecord({
			key: "checkout-redesign",
			providerName: "launchdarkly",
			reason: "targeting_match",
			value: true,
		});
		expect(records[0]?.eventName).toBe("feature_flag.evaluation");
		expect(records[0]?.attributes).toEqual({
			"feature_flag.key": "checkout-redesign",
			"feature_flag.provider.name": "launchdarkly",
			"feature_flag.result.reason": "targeting_match",
			"feature_flag.result.value": true,
		});
	});

	it("records the variant and not the value when the service gave a variant", () => {
		featureFlagsLaunchDarklyEvaluationRecord({
			key: "hero-copy",
			value: "long copy",
			variant: "b",
		});
		expect(records[0]?.attributes).toEqual({
			"feature_flag.key": "hero-copy",
			"feature_flag.result.variant": "b",
		});
	});

	it("never records an object or a string as the value", () => {
		featureFlagsLaunchDarklyEvaluationRecord({
			key: "a",
			value: { big: true },
		});
		featureFlagsLaunchDarklyEvaluationRecord({
			key: "b",
			value: "jane@example.com",
		});
		expect(records.map((record) => record.attributes)).toEqual([
			{ "feature_flag.key": "a" },
			{ "feature_flag.key": "b" },
		]);
	});

	it("sets error.type on a failure", () => {
		featureFlagsLaunchDarklyEvaluationRecord({
			errorType: "flag_not_found",
			key: "gone",
			reason: "error",
		});
		expect(records[0]?.attributes).toMatchObject({
			"error.type": "flag_not_found",
			"feature_flag.result.reason": "error",
		});
	});
});
