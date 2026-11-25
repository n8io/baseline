import type { EvaluationContext } from "@openfeature/web-sdk";
import type { FeatureFlagContextResolved } from "../core/feature-flags-context.ts";

/**
 * Turns a context into the shape the LaunchDarkly provider reads: one kind stays a single-kind
 * context, several become a multi-kind one. `id` always wins over an attribute named
 * `targetingKey`. No kind at all is an anonymous visitor, which LaunchDarkly keys itself.
 */
export const featureFlagsLaunchDarklyClientContextTranslate = (
	context: FeatureFlagContextResolved,
): EvaluationContext => {
	const kinds = Object.entries(context);
	const [first] = kinds;
	if (first === undefined) {
		return { anonymous: true, targetingKey: "" };
	}
	const entryOf = ([, entry]: (typeof kinds)[number]) => ({
		...entry.attributes,
		targetingKey: entry.id,
	});
	return kinds.length === 1
		? { ...entryOf(first), kind: first[0] }
		: {
				kind: "multi",
				...Object.fromEntries(kinds.map((kind) => [kind[0], entryOf(kind)])),
			};
};
