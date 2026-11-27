import { type LogRecord, logs } from "@opentelemetry/api";
import { beforeEach, describe, expect, it } from "vitest";
import type { FeatureFlagFallbackReason } from "../core/feature-flags-resolve-types.ts";
import { featureFlagsLaunchDarklyEvaluationReport } from "./feature-flags-launch-darkly-evaluation-report.ts";

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

const evaluationOf = ({
	fallbackReason = null,
	reason = null,
}: {
	fallbackReason?: FeatureFlagFallbackReason | null;
	reason?: string | null;
}) => ({
	fallbackReason,
	flag: "itemLimit",
	key: "item-limit",
	reason,
	value: 3,
	variant: null,
});

describe("featureFlagsLaunchDarklyEvaluationReport", () => {
	it.each([
		["CACHED", "cached"],
		["DEFAULT", "default"],
		["DISABLED", "disabled"],
		["ERROR", "error"],
		["FALLTHROUGH", "default"],
		["OFF", "disabled"],
		["RULE_MATCH", "targeting_match"],
		["SPLIT", "split"],
		["STALE", "stale"],
		["STATIC", "static"],
		["TARGET_MATCH", "targeting_match"],
		["TARGETING_MATCH", "targeting_match"],
	])("names the service's reason %s as %s", (reason, named) => {
		featureFlagsLaunchDarklyEvaluationReport(evaluationOf({ reason }));
		expect(records[0]?.attributes).toEqual({
			"feature_flag.key": "item-limit",
			"feature_flag.provider.name": "launchdarkly",
			"feature_flag.result.reason": named,
			"feature_flag.result.value": 3,
		});
	});

	it.each([null, "SOMETHING_NEW"])(
		"names the reason %s as unknown",
		(reason) => {
			featureFlagsLaunchDarklyEvaluationReport(evaluationOf({ reason }));
			expect(records[0]?.attributes).toMatchObject({
				"feature_flag.result.reason": "unknown",
			});
			expect(records[0]?.attributes).not.toHaveProperty("error.type");
		},
	);

	it.each<[FeatureFlagFallbackReason, string]>([
		["closed", "general"],
		["notFound", "flag_not_found"],
		["notInValues", "parse_error"],
		["notReady", "provider_not_ready"],
		["schemaFailed", "parse_error"],
		["vendorError", "general"],
		["wrongType", "type_mismatch"],
	])(
		"records the fallback %s as an error of type %s",
		(fallbackReason, type) => {
			featureFlagsLaunchDarklyEvaluationReport(
				evaluationOf({ fallbackReason, reason: "STATIC" }),
			);
			expect(records[0]?.attributes).toMatchObject({
				"error.type": type,
				"feature_flag.result.reason": "error",
			});
		},
	);
});
