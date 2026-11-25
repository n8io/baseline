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
	featureFlagsResolve,
} from "./feature-flags-resolve.ts";
import { featureFlagsValueIsEqual } from "./feature-flags-value-is-equal.ts";

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
	readonly onFallback?: ((fallback: FeatureFlagFallback) => void) | null;
	readonly source: FeatureFlagsClientSource;
};

/**
 * Builds the browser's flags from an adapter's source. It keeps one snapshot per flag, refreshes
 * it on every event, keeps the old reference when the new value is equal by content, and notifies
 * only the subscribers of flags whose value changed.
 */
export const featureFlagsClientCreate = <
	const D extends FeatureFlagDefinitions,
	const K extends FeatureFlagKinds = Record<never, never>,
>({
	flags,
	onFallback,
	source,
}: FeatureFlagsClientOptions<D, K>): FeatureFlagsClient<D, K> => {
	let settled = false;
	let closing: Promise<void> | undefined;
	const snapshots = new Map<string, unknown>();
	const listeners = new Map<string, Set<() => void>>();
	const reported = new Map<string, string>();
	const report = (fallback: FeatureFlagFallback | null, flag: string): void => {
		const now = fallback?.reason ?? "";
		if ((reported.get(flag) ?? "") === now) {
			return;
		}
		reported.set(flag, now);
		if (fallback === null || fallback.reason === "notReady") {
			return;
		}
		try {
			onFallback?.(fallback);
		} catch {
			// A logger that throws must not fail a read.
		}
	};
	const compute = (flag: string): unknown => {
		const definition = Object.hasOwn(flags, flag) ? flags[flag] : undefined;
		if (definition === undefined) {
			report({ flag, key: "", reason: "notFound" }, flag);
			return undefined;
		}
		if (!settled) {
			report({ flag, key: definition.key, reason: "notReady" }, flag);
			return definition.fallback;
		}
		const resolved = featureFlagsResolve({
			definition,
			read: source.read({
				fallback: definition.fallback,
				key: definition.key,
			}),
		});
		report(
			resolved.reason === null
				? null
				: { flag, key: definition.key, reason: resolved.reason },
			flag,
		);
		return resolved.value;
	};
	const refresh = (): void => {
		for (const [flag, before] of [...snapshots]) {
			const after = compute(flag);
			if (!featureFlagsValueIsEqual(before, after)) {
				snapshots.set(flag, after);
				for (const listener of [...(listeners.get(flag) ?? [])]) {
					listener();
				}
			}
		}
	};
	const ready = source.ready.then(
		(status) => {
			settled = true;
			refresh();
			return status;
		},
		() => {
			settled = true;
			refresh();
			return "failed" as const;
		},
	);
	const unsubscribe = source.subscribe(refresh);
	const close = (): Promise<void> => {
		closing ??= (async () => {
			unsubscribe();
			listeners.clear();
			await source.close().catch(() => undefined);
		})();
		return closing;
	};
	return {
		close,
		contextSet: async (context) => {
			if (closing !== undefined) {
				return;
			}
			await source
				.contextSet(featureFlagsContextFreeze(context))
				.catch(() => undefined);
			refresh();
		},
		flags: {
			// boundary: the value was checked against the flag's definition by featureFlagsResolve
			get: ((flag: string) => {
				if (!snapshots.has(flag)) {
					snapshots.set(flag, compute(flag));
				}
				return snapshots.get(flag);
			}) as FeatureFlagsBrowser<D>["get"],
			subscribe: (flag, listener) => {
				const set = listeners.get(flag) ?? new Set<() => void>();
				listeners.set(flag, set.add(listener));
				return () => {
					set.delete(listener);
				};
			},
		},
		ready,
		[Symbol.asyncDispose]: close,
	};
};
