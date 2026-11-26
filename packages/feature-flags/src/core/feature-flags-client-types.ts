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
	FeatureFlagRead,
	FeatureFlagsOnFallback,
	FeatureFlagsReadyStatus,
} from "./feature-flags-resolve-types.ts";

/** Reads from a snapshot the browser already holds, so a read is synchronous. */
export type FeatureFlagsBrowser<D extends FeatureFlagDefinitions> = {
	/**
	 * The flag's value for the current context, or its fallback. The same value is the same
	 * reference until the flag changes, so a React render can compare it.
	 */
	get<N extends keyof D & string>(flag: N): FlagValue<D[N]>;
	/** Calls `listener` after this flag's value changed, never for another flag's change. */
	subscribe(flag: keyof D & string, listener: () => void): () => void;
};

/**
 * The browser's flags: one client holds one context. Lifecycle sits beside `flags`, never on it,
 * so a flag may be named `ready`.
 */
export type FeatureFlagsClient<
	D extends FeatureFlagDefinitions,
	K extends FeatureFlagKinds,
> = {
	readonly flags: FeatureFlagsBrowser<D>;
	/** Settles, never rejects. Until it settles `connected`, reads return fallbacks. */
	readonly ready: Promise<FeatureFlagsReadyStatus>;
	/** Replaces the whole context and resolves when the new values are in. Never rejects. */
	contextSet(context: FeatureFlagContext<K>): Promise<void>;
	/** Stops listening to the flag service and drops every subscriber. Safe to call twice. */
	close(): Promise<void>;
	/** Calls close(), so `await using` closes it when its block ends. */
	[Symbol.asyncDispose](): Promise<void>;
};

/** What an adapter gives the browser's flags: a snapshot read, change events and its lifecycle. */
export type FeatureFlagsClientSource = {
	read(input: {
		readonly fallback: unknown;
		readonly key: string;
	}): FeatureFlagRead;
	/** Calls `listener` when any value may have changed: ready, a flag change, a context change. */
	subscribe(listener: () => void): () => void;
	contextSet(context: FeatureFlagContextResolved): Promise<void>;
	readonly ready: Promise<FeatureFlagsReadyStatus>;
	close(): Promise<void>;
};

/** What `featureFlagsClientCreate` takes. `kinds` only types the context. */
export type FeatureFlagsClientOptions<
	D extends FeatureFlagDefinitions,
	K extends FeatureFlagKinds,
> = {
	readonly flags: D;
	readonly kinds?: K | null;
	/** Called with each fallback a read returns, to log it. A throw is ignored. */
	readonly onFallback?: FeatureFlagsOnFallback | null;
	readonly source: FeatureFlagsClientSource;
};
