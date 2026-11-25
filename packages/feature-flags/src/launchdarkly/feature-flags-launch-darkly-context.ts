import type { EvaluationContext } from "@openfeature/server-sdk";
import type { FeatureFlagContextResolved } from "../core/feature-flags-context.ts";

/**
 * A context in the shape LaunchDarkly's OpenFeature provider reads: one multi-kind context with an
 * entry for each kind. `id` becomes the kind's key; an attribute named `targetingKey` cannot
 * replace it.
 */
export const featureFlagsLaunchDarklyContext = (
	context: FeatureFlagContextResolved,
): EvaluationContext => ({
	...Object.fromEntries(
		Object.entries(context).map(([kind, { attributes, id }]) => [
			kind,
			{ ...attributes, targetingKey: id },
		]),
	),
	kind: "multi",
});
