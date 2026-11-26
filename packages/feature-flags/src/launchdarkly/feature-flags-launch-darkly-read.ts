import type { EvaluationDetails, JsonValue } from "@openfeature/server-sdk";
import type { FeatureFlagRead } from "../core/feature-flags-resolve-types.ts";

/** Turns one OpenFeature evaluation into what the flags read: the value, or why there is none. */
export const featureFlagsLaunchDarklyRead = ({
	errorCode,
	reason,
	value,
	variant,
}: {
	readonly errorCode?: EvaluationDetails<JsonValue>["errorCode"];
	readonly reason?: string;
	readonly value: unknown;
	readonly variant?: string;
}): FeatureFlagRead => {
	switch (errorCode) {
		case undefined:
			return {
				found: true,
				reason: reason ?? null,
				value,
				variant: variant ?? null,
			};
		case "FLAG_NOT_FOUND":
			return { found: false, reason: "notFound" };
		case "TYPE_MISMATCH":
			return { found: false, reason: "wrongType" };
		default:
			return { found: false, reason: "vendorError" };
	}
};
