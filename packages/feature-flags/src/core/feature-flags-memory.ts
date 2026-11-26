import type {
	FeatureFlagContext,
	FeatureFlagKinds,
} from "./feature-flags-context.ts";
import type { FeatureFlagDefinitions } from "./feature-flags-define.ts";
import {
	type FeatureFlagMemoryValues,
	featureFlagsMemorySourceServerCreate,
	featureFlagsMemorySourceValuesByKey,
} from "./feature-flags-memory-source.ts";
import type {
	FeatureFlagsOnFallback,
	FeatureFlagsReadyStatus,
} from "./feature-flags-resolve.ts";
import {
	type FeatureFlags,
	featureFlagsServerCreate,
} from "./feature-flags-server.ts";

/** What `featureFlagsMemoryCreate` takes. */
export type FeatureFlagsMemoryOptions<
	D extends FeatureFlagDefinitions,
	K extends FeatureFlagKinds,
> = {
	readonly flags: D;
	readonly kinds?: K | null;
	/** Called with each fallback a read returns, as the logger would be. */
	readonly onFallback?: FeatureFlagsOnFallback | null;
	/** How ready settles. Anything but `connected` makes every read a fallback, like an outage. */
	readonly ready?: FeatureFlagsReadyStatus | null;
	/** Flag values, by flag name, typed per flag; or a function of the context a read is for. */
	readonly values?:
		| FeatureFlagMemoryValues<D>
		| ((context: FeatureFlagContext<K>) => FeatureFlagMemoryValues<D>)
		| null;
};

/**
 * The server's flags answering from memory, for tests and development. Same type as the real
 * flags and the same fallback rules. Reads return fallbacks until `ready` settles, so tests
 * `await featureFlags.ready` first. A flag left out of `values` reads as its fallback.
 */
export const featureFlagsMemoryCreate = <
	const D extends FeatureFlagDefinitions,
	const K extends FeatureFlagKinds = Record<never, never>,
>({
	flags,
	onFallback,
	ready,
	values,
}: FeatureFlagsMemoryOptions<D, K>): FeatureFlags<D, K> =>
	featureFlagsServerCreate<D, K>({
		flags,
		onFallback: onFallback ?? null,
		source: featureFlagsMemorySourceServerCreate({
			ready: ready ?? null,
			values: featureFlagsMemorySourceValuesByKey({
				flags,
				// boundary: the resolved context holds exactly the kinds a FeatureFlagContext<K> does
				values: (context) =>
					typeof values === "function"
						? values(context as FeatureFlagContext<K>)
						: (values ?? {}),
			}),
		}),
	});
