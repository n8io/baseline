import type {
	FeatureFlagContext,
	FeatureFlagContextResolved,
	FeatureFlagKinds,
} from "./feature-flags-context.ts";
import type {
	FeatureFlagDefinitions,
	FlagValue,
} from "./feature-flags-define-types.ts";
import type {
	FeatureFlagEvaluation,
	FeatureFlagRead,
	FeatureFlagsOnFallback,
	FeatureFlagsReadyStatus,
} from "./feature-flags-resolve-types.ts";

/** Reads flags for one context. A read never throws and never waits on a flag service for long. */
export type FeatureFlagsHandle<D extends FeatureFlagDefinitions> = {
	/** The flag's value, or its declared fallback (and a log line) when the service cannot answer. */
	get<N extends keyof D & string>(flag: N): Promise<FlagValue<D[N]>>;
};

/**
 * The server's flags: closeable, and opened once per process. `context()` makes a handle for one
 * complete context. Lifecycle sits beside the flags, never on them, so a flag may be named `ready`.
 */
export type FeatureFlags<
	D extends FeatureFlagDefinitions,
	K extends FeatureFlagKinds,
> = {
	/** A handle that reads every flag for exactly this context. Nothing is merged or inherited. */
	context(context: FeatureFlagContext<K>): FeatureFlagsHandle<D>;
	/** Settles, never rejects. Until it settles `connected`, reads return fallbacks. */
	readonly ready: Promise<FeatureFlagsReadyStatus>;
	/** Closes this instance's connection to the flag service. Safe to call twice. */
	close(): Promise<void>;
	/** Calls close(), so `await using` closes it when its block ends. */
	[Symbol.asyncDispose](): Promise<void>;
};

/** What an adapter gives the server's flags: one read per key and context, and its own lifecycle. */
export type FeatureFlagsServerSource = {
	read(input: {
		readonly context: FeatureFlagContextResolved;
		readonly fallback: unknown;
		readonly key: string;
	}): Promise<FeatureFlagRead>;
	readonly ready: Promise<FeatureFlagsReadyStatus>;
	close(): Promise<void>;
};

/** What `featureFlagsServerCreate` takes. `kinds` only types the context. */
export type FeatureFlagsServerOptions<
	D extends FeatureFlagDefinitions,
	K extends FeatureFlagKinds,
> = {
	readonly flags: D;
	readonly kinds?: K | null;
	/** Called after every read of a declared flag, to record it as telemetry. A throw is ignored. */
	readonly onEvaluation?:
		| ((evaluation: FeatureFlagEvaluation) => unknown)
		| null;
	/**
	 * Called with each fallback a read returns, to log it. A flag service outage is called once,
	 * when it starts, not on every read. A throw is ignored.
	 */
	readonly onFallback?: FeatureFlagsOnFallback | null;
	/** Called once when reads succeed again after an outage was reported. A throw is ignored. */
	readonly onRecovered?: (() => unknown) | null;
	readonly source: FeatureFlagsServerSource;
};
