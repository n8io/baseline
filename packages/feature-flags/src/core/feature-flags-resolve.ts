import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { FeatureFlagDefinition } from "./feature-flags-define.ts";

/** Why a read returned the declared fallback instead of the flag service's value. */
export type FeatureFlagFallbackReason =
	| "closed"
	| "notFound"
	| "notInValues"
	| "notReady"
	| "schemaFailed"
	| "vendorError"
	| "wrongType";

/** What is logged when a read returns the fallback: the flag's name, its key and why. */
export type FeatureFlagFallback = {
	readonly flag: string;
	readonly key: string;
	readonly reason: FeatureFlagFallbackReason;
};

/** What a flag service answered for one key: a value of any type, or why it has none. */
export type FeatureFlagRead =
	| {
			readonly found: true;
			/** How the flag service decided the value, in its own words, for telemetry. Optional. */
			readonly reason?: string | null;
			readonly value: unknown;
			/** The flag service's name for the value, for telemetry. Optional. */
			readonly variant?: string | null;
	  }
	| {
			readonly found: false;
			readonly reason: "notFound" | "vendorError" | "wrongType";
	  };

/**
 * Where a flag service stands: `connected`, `failed` (it said no) or `timeout` (it did not answer in
 * time). Reads return fallbacks until it is connected.
 */
export type FeatureFlagsReadyStatus = "connected" | "failed" | "timeout";

type SchemaResult =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly async: boolean };

const featureFlagsIsThenable = (
	result: unknown,
): result is PromiseLike<unknown> =>
	typeof result === "object" &&
	result !== null &&
	typeof (result as { then?: unknown }).then === "function";

/** Runs a Standard Schema that must answer at once. A throw or a Promise is a failure. */
export const featureFlagsSchemaValidate = ({
	schema,
	value,
}: {
	schema: StandardSchemaV1;
	value: unknown;
}): SchemaResult => {
	try {
		const result = schema["~standard"].validate(value);
		if (featureFlagsIsThenable(result)) {
			return { async: true, ok: false };
		}
		return result.issues === undefined
			? { ok: true, value: result.value }
			: { async: false, ok: false };
	} catch {
		return { async: false, ok: false };
	}
};

/** What an adapter hears of each evaluation of a declared flag, to record it as telemetry. */
export type FeatureFlagEvaluation = {
	/** Why the read returned the fallback. Null when it returned the flag service's value. */
	readonly fallbackReason: FeatureFlagFallbackReason | null;
	readonly flag: string;
	readonly key: string;
	/** The flag service's reason for its value, when it gave one. */
	readonly reason: string | null;
	/** The value the read returned. */
	readonly value: unknown;
	/** The flag service's name for its value, when it gave one. */
	readonly variant: string | null;
};

/** Receives each fallback a read returns, to log it. A throw or a rejected Promise is ignored. */
export type FeatureFlagsOnFallback = (fallback: FeatureFlagFallback) => unknown;

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

/** Tells the Project's logger an outage ended. A logger that throws must not fail a read. */
export const featureFlagsRecoveredReport = (
	onRecovered: (() => unknown) | null | undefined,
): void => {
	try {
		Promise.resolve(onRecovered?.()).catch(() => undefined);
	} catch {
		// A logger that throws must not fail a read.
	}
};

/** What a read returns: the value, and the reason it is the fallback when it is. */
export type FeatureFlagResolved = {
	readonly reason: FeatureFlagFallbackReason | null;
	readonly value: unknown;
};

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
