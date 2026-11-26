import type { FeatureFlagEvaluation } from "../core/feature-flags-resolve-types.ts";
import { featureFlagsLaunchDarklyEvaluationRecord } from "./feature-flags-launch-darkly-evaluation.ts";

// LaunchDarkly's reason kinds, and OpenFeature's, as the convention names them.
const reasonsConvention: Readonly<Record<string, string>> = {
	CACHED: "cached",
	DEFAULT: "default",
	DISABLED: "disabled",
	ERROR: "error",
	FALLTHROUGH: "default",
	OFF: "disabled",
	RULE_MATCH: "targeting_match",
	SPLIT: "split",
	STALE: "stale",
	STATIC: "static",
	TARGET_MATCH: "targeting_match",
	TARGETING_MATCH: "targeting_match",
};

// The convention's error.type for each fallback. A read that failed is reason "error".
const errorTypes: Readonly<Record<string, string>> = {
	closed: "general",
	notFound: "flag_not_found",
	notInValues: "parse_error",
	notReady: "provider_not_ready",
	schemaFailed: "parse_error",
	vendorError: "general",
	wrongType: "type_mismatch",
};

// Records each evaluation as the OpenTelemetry `feature_flag.evaluation` event. Never the context.
export const featureFlagsLaunchDarklyEvaluationReport = ({
	fallbackReason,
	key,
	reason,
	value,
	variant,
}: FeatureFlagEvaluation): void => {
	featureFlagsLaunchDarklyEvaluationRecord({
		errorType:
			fallbackReason === null ? null : (errorTypes[fallbackReason] ?? null),
		key,
		providerName: "launchdarkly",
		reason:
			fallbackReason === null
				? (reasonsConvention[reason ?? ""] ?? "unknown")
				: "error",
		value,
		variant,
	});
};
