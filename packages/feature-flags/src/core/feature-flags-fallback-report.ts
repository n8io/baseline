import type {
	FeatureFlagFallback,
	FeatureFlagsOnFallback,
} from "./feature-flags-resolve-types.ts";

/**
 * Passes a fallback to the Project's logger. A logger that throws, or returns a rejected Promise,
 * must not fail a read.
 */
export const featureFlagsFallbackReport = ({
	fallback,
	onFallback,
}: {
	fallback: FeatureFlagFallback;
	onFallback: FeatureFlagsOnFallback | null | undefined;
}): void => {
	try {
		Promise.resolve(onFallback?.(fallback)).catch(() => undefined);
	} catch {
		// A logger that throws must not fail a read.
	}
};
