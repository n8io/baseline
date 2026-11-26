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

/** What a read returns: the value, and the reason it is the fallback when it is. */
export type FeatureFlagResolved = {
	readonly reason: FeatureFlagFallbackReason | null;
	readonly value: unknown;
};
