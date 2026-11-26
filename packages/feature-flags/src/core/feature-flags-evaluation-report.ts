import type { FeatureFlagEvaluation } from "./feature-flags-resolve-types.ts";

/** Passes an evaluation to telemetry. A recorder that throws must not fail a read. */
export const featureFlagsEvaluationReport = ({
	evaluation,
	onEvaluation,
}: {
	evaluation: FeatureFlagEvaluation;
	onEvaluation:
		| ((evaluation: FeatureFlagEvaluation) => unknown)
		| null
		| undefined;
}): void => {
	try {
		Promise.resolve(onEvaluation?.(evaluation)).catch(() => undefined);
	} catch {
		// A recorder that throws must not fail a read.
	}
};
