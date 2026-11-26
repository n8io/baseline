// Copied from packages/telemetry/src/telemetry-feature-flag.ts; keep the two in step.
import { logs, SeverityNumber } from "@opentelemetry/api";

/**
 * One flag evaluation, in the words of the OpenTelemetry feature-flag conventions. Never holds a
 * context: an evaluation context may be personal data.
 */
type Evaluation = {
	/** Why an error happened, one of the convention's `error.type` values. Null when none did. */
	readonly errorType?: string | null;
	/** Names the flag service, such as `launchdarkly`. */
	readonly providerName?: string | null;
	/** How the value was decided, one of the convention's reasons: `targeting_match`, `default`. */
	readonly reason?: string | null;
	/** The flag's key in the flag service. */
	readonly key: string;
	/** The value returned. Recorded only when the flag service gave no variant, and only a boolean or a number. */
	readonly value?: unknown;
	/** The flag service's name for the value returned, such as `on`. */
	readonly variant?: string | null;
};

// The instrumentation scope of the records this Package emits.
const scope = "@n8io/baseline-feature-flags";

// Only a boolean or a number: a string flag's value may be derived from a person.
const valueScalar = (value: unknown): boolean | number | null =>
	typeof value === "boolean" || typeof value === "number" ? value : null;

/**
 * Records one flag evaluation as the `feature_flag.evaluation` log record the OpenTelemetry
 * feature-flag conventions define (Release Candidate). The record carries the active trace, so it
 * is found from the request's span; the span itself gets nothing. Never throws.
 */
export const featureFlagsLaunchDarklyEvaluationRecord = (
	evaluation: Evaluation,
): void => {
	try {
		const text =
			evaluation.variant == null ? valueScalar(evaluation.value) : null;
		const attributes: Record<string, boolean | number | string> = {
			"feature_flag.key": evaluation.key,
		};
		const optional = {
			"error.type": evaluation.errorType,
			"feature_flag.provider.name": evaluation.providerName,
			"feature_flag.result.reason": evaluation.reason,
			"feature_flag.result.value": text,
			"feature_flag.result.variant": evaluation.variant,
		};
		for (const [name, value] of Object.entries(optional)) {
			if (value != null) {
				attributes[name] = value;
			}
		}
		logs.getLogger(scope).emit({
			attributes,
			eventName: "feature_flag.evaluation",
			severityNumber: SeverityNumber.INFO,
		});
	} catch {
		// Recording must never fail a flag read.
	}
};
