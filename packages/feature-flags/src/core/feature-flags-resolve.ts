import type { FeatureFlagDefinition } from "./feature-flags-define-types.ts";
import type {
	FeatureFlagFallbackReason,
	FeatureFlagRead,
	FeatureFlagResolved,
} from "./feature-flags-resolve-types.ts";
import { featureFlagsSchemaValidate } from "./feature-flags-schema-validate.ts";

/**
 * Turns the flag service's answer into the value the Project declared: the answer when it has the
 * declared type, else the fallback and the reason. Never throws.
 */
export const featureFlagsResolve = ({
	definition,
	read,
}: {
	definition: FeatureFlagDefinition;
	read: FeatureFlagRead;
}): FeatureFlagResolved => {
	const fallback = (reason: FeatureFlagFallbackReason) => ({
		reason,
		value: definition.fallback,
	});
	if (!read.found) {
		return fallback(read.reason);
	}
	const { value } = read;
	if (definition.schema !== undefined) {
		const result = featureFlagsSchemaValidate({
			schema: definition.schema,
			value,
		});
		return result.ok
			? { reason: null, value: result.value }
			: fallback("schemaFailed");
	}
	if (typeof value !== typeof definition.fallback) {
		return fallback("wrongType");
	}
	if (
		definition.values !== undefined &&
		!definition.values.some((allowed) => allowed === value)
	) {
		return fallback("notInValues");
	}
	return { reason: null, value };
};
