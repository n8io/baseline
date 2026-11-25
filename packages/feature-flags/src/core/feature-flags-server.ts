import {
	type FeatureFlagContext,
	type FeatureFlagContextResolved,
	type FeatureFlagKinds,
	featureFlagsContextFreeze,
} from "./feature-flags-context.ts";
import type {
	FeatureFlagDefinitions,
	FlagValue,
} from "./feature-flags-define.ts";
import {
	type FeatureFlagFallback,
	type FeatureFlagRead,
	type FeatureFlagsReadyStatus,
	featureFlagsFallbackReport,
	featureFlagsResolve,
} from "./feature-flags-resolve.ts";

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
	/** Called with each fallback a read returns, to log it. A throw is ignored. */
	readonly onFallback?: ((fallback: FeatureFlagFallback) => unknown) | null;
	readonly source: FeatureFlagsServerSource;
};

const silentReasons: ReadonlySet<string> = new Set(["closed", "notReady"]);

/**
 * Builds the server's flags from an adapter's source: the type checks, fallbacks, logging and
 * lifecycle every adapter shares. A flag service's answer of the wrong type, outside `values`, or
 * failing `schema` reads as the fallback; so does an outage, a missing flag and a closed instance.
 */
export const featureFlagsServerCreate = <
	const D extends FeatureFlagDefinitions,
	const K extends FeatureFlagKinds = Record<never, never>,
>({
	flags,
	onFallback,
	source,
}: FeatureFlagsServerOptions<D, K>): FeatureFlags<D, K> => {
	let settled = false;
	let closing: Promise<void> | undefined;
	const notFoundReported = new Set<string>();
	const ready = source.ready.then(
		(status) => {
			settled = true;
			return status;
		},
		() => {
			settled = true;
			return "failed" as const;
		},
	);
	const report = (fallback: FeatureFlagFallback): void => {
		if (silentReasons.has(fallback.reason)) {
			return;
		}
		if (fallback.reason === "notFound") {
			if (notFoundReported.has(fallback.flag)) {
				return;
			}
			notFoundReported.add(fallback.flag);
		}
		featureFlagsFallbackReport({ fallback, onFallback });
	};
	const get = async (
		flag: string,
		context: FeatureFlagContextResolved,
	): Promise<unknown> => {
		const definition = Object.hasOwn(flags, flag) ? flags[flag] : undefined;
		if (definition === undefined) {
			report({ flag, key: "", reason: "notFound" });
			return undefined;
		}
		const fallbackFor = (reason: FeatureFlagFallback["reason"]): unknown => {
			report({ flag, key: definition.key, reason });
			return definition.fallback;
		};
		if (closing !== undefined) {
			return fallbackFor("closed");
		}
		if (!settled) {
			return fallbackFor("notReady");
		}
		// An async wrapper, so a source that throws before it returns a Promise is caught too.
		const read = await (async () =>
			source.read({
				context,
				fallback: definition.fallback,
				key: definition.key,
			}))().catch(
			(): FeatureFlagRead => ({ found: false, reason: "vendorError" }),
		);
		const resolved = featureFlagsResolve({ definition, read });
		return resolved.reason === null
			? resolved.value
			: fallbackFor(resolved.reason);
	};
	const close = (): Promise<void> => {
		closing ??= (async () => source.close())().catch(() => undefined);
		return closing;
	};
	return {
		close,
		context: (context) => {
			const frozen = featureFlagsContextFreeze(context);
			return {
				// boundary: the value was checked against the flag's definition by featureFlagsResolve
				get: ((flag: string) =>
					get(flag, frozen)) as FeatureFlagsHandle<D>["get"],
			};
		},
		ready,
		[Symbol.asyncDispose]: close,
	};
};
