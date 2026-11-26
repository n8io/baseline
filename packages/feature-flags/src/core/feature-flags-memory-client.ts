import {
	type FeatureFlagsClient,
	featureFlagsClientCreate,
} from "./feature-flags-client.ts";
import {
	type FeatureFlagContext,
	type FeatureFlagKinds,
	featureFlagsContextFreeze,
} from "./feature-flags-context.ts";
import type { FeatureFlagDefinitions } from "./feature-flags-define.ts";
import {
	type FeatureFlagMemoryValues,
	featureFlagsMemorySourceClientCreate,
	featureFlagsMemorySourceValuesByKey,
} from "./feature-flags-memory-source.ts";
import type {
	FeatureFlagsOnFallback,
	FeatureFlagsReadyStatus,
} from "./feature-flags-resolve.ts";

/** The values a memory client holds: typed per flag, or a function of the current context. */
export type FeatureFlagsMemoryClientValues<
	D extends FeatureFlagDefinitions,
	K extends FeatureFlagKinds,
> =
	| FeatureFlagMemoryValues<D>
	| ((context: FeatureFlagContext<K>) => FeatureFlagMemoryValues<D>);

/** What `featureFlagsMemoryClientCreate` takes. */
export type FeatureFlagsMemoryClientOptions<
	D extends FeatureFlagDefinitions,
	K extends FeatureFlagKinds,
> = {
	readonly context: FeatureFlagContext<K>;
	readonly flags: D;
	readonly kinds?: K | null;
	/** Called with each fallback a read returns, as the logger would be. */
	readonly onFallback?: FeatureFlagsOnFallback | null;
	/** How ready settles. Anything but `connected` makes every read a fallback, like an outage. */
	readonly ready?: FeatureFlagsReadyStatus | null;
	readonly values?: FeatureFlagsMemoryClientValues<D, K> | null;
};

/** A memory client, which tests can also change the values of. */
export type FeatureFlagsMemoryClient<
	D extends FeatureFlagDefinitions,
	K extends FeatureFlagKinds,
> = FeatureFlagsClient<D, K> & {
	/** Replaces every value, as the flag service pushing a change, and notifies subscribers. */
	valuesSet(values: FeatureFlagsMemoryClientValues<D, K>): void;
};

/**
 * The browser's flags answering from memory, for tests and development: same type, same fallback
 * rules, `subscribe` and `contextSet` as the real client. Reads return fallbacks until `ready`
 * settles, so tests `await client.ready` first.
 */
export const featureFlagsMemoryClientCreate = <
	const D extends FeatureFlagDefinitions,
	const K extends FeatureFlagKinds = Record<never, never>,
>({
	context,
	flags,
	onFallback,
	ready,
	values,
}: FeatureFlagsMemoryClientOptions<D, K>): FeatureFlagsMemoryClient<D, K> => {
	const byKeyOf = (next: FeatureFlagsMemoryClientValues<D, K> | null) =>
		featureFlagsMemorySourceValuesByKey({
			flags,
			// boundary: the resolved context holds exactly the kinds a FeatureFlagContext<K> does
			values: (resolved) =>
				typeof next === "function"
					? next(resolved as FeatureFlagContext<K>)
					: (next ?? {}),
		});
	const source = featureFlagsMemorySourceClientCreate({
		context: featureFlagsContextFreeze(context),
		ready: ready ?? null,
		values: byKeyOf(values ?? null),
	});
	return {
		...featureFlagsClientCreate<D, K>({
			flags,
			onFallback: onFallback ?? null,
			source,
		}),
		valuesSet: (next) => source.valuesSet(byKeyOf(next)),
	};
};
