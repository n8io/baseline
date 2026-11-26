import type {
	FeatureFlagsBrowser,
	FeatureFlagsClient,
	FeatureFlagsClientOptions,
} from "./feature-flags-client-types.ts";
import {
	type FeatureFlagKinds,
	featureFlagsContextFreeze,
} from "./feature-flags-context.ts";
import type { FeatureFlagDefinitions } from "./feature-flags-define-types.ts";
import { featureFlagsFallbackReport } from "./feature-flags-fallback-report.ts";
import { featureFlagsResolve } from "./feature-flags-resolve.ts";
import type {
	FeatureFlagFallback,
	FeatureFlagRead,
} from "./feature-flags-resolve-types.ts";
import { featureFlagsValueIsEqual } from "./feature-flags-value-is-equal.ts";

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
	const listeners = new Map<string, Set<{ listener: () => void }>>();
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
		featureFlagsFallbackReport({ fallback, onFallback });
	};
	const sourceRead = (input: {
		readonly fallback: unknown;
		readonly key: string;
	}): FeatureFlagRead => {
		try {
			return source.read(input);
		} catch {
			return { found: false, reason: "vendorError" };
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
			read: sourceRead({ fallback: definition.fallback, key: definition.key }),
		});
		report(
			resolved.reason === null
				? null
				: { flag, key: definition.key, reason: resolved.reason },
			flag,
		);
		return resolved.value;
	};
	// Every snapshot is replaced before any subscriber hears of it, and a subscriber that throws
	// neither stops the others nor fails the caller.
	const refresh = (): void => {
		if (closing !== undefined) {
			return;
		}
		const changed = [...snapshots].flatMap(([flag, before]) => {
			const after = compute(flag);
			return featureFlagsValueIsEqual(before, after) ? [] : [{ after, flag }];
		});
		for (const { after, flag } of changed) {
			snapshots.set(flag, after);
		}
		for (const { flag } of changed) {
			for (const entry of [...(listeners.get(flag) ?? [])]) {
				try {
					entry.listener();
				} catch {
					// A subscriber that throws must not fail a refresh.
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
			await (async () => source.close())().catch(() => undefined);
		})();
		return closing;
	};
	return {
		close,
		contextSet: async (context) => {
			if (closing !== undefined) {
				return;
			}
			await (async () =>
				source.contextSet(featureFlagsContextFreeze(context)))().catch(
				() => undefined,
			);
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
				if (closing !== undefined) {
					return () => undefined;
				}
				// An entry per subscription, so one function subscribed twice unsubscribes separately.
				const entry = { listener };
				const set = listeners.get(flag) ?? new Set<{ listener: () => void }>();
				listeners.set(flag, set.add(entry));
				return () => {
					set.delete(entry);
				};
			},
		},
		ready,
		[Symbol.asyncDispose]: close,
	};
};
