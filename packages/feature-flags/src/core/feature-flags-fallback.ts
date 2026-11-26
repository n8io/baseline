import type { FeatureFlagKinds } from "./feature-flags-context.ts";
import type { FeatureFlagDefinitions } from "./feature-flags-define-types.ts";
import { featureFlagsServerCreate } from "./feature-flags-server.ts";
import type { FeatureFlags } from "./feature-flags-server-types.ts";

/** What `featureFlagsFallbackCreate` takes. */
export type FeatureFlagsFallbackOptions<
	D extends FeatureFlagDefinitions,
	K extends FeatureFlagKinds,
> = {
	readonly flags: D;
	readonly kinds?: K | null;
};

/**
 * The server's flags with no flag service: every read returns the flag's declared fallback,
 * quietly, and `ready` settles `connected`. For a Project that has not set up a flag service, so
 * code never branches on whether flags are on.
 */
export const featureFlagsFallbackCreate = <
	const D extends FeatureFlagDefinitions,
	const K extends FeatureFlagKinds = Record<never, never>,
>({
	flags,
}: FeatureFlagsFallbackOptions<D, K>): FeatureFlags<D, K> =>
	featureFlagsServerCreate<D, K>({
		flags,
		source: {
			close: async () => undefined,
			read: async ({ fallback }) => ({ found: true, value: fallback }),
			ready: Promise.resolve("connected"),
		},
	});
