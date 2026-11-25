import type { LDOptions } from "@launchdarkly/js-client-sdk";
import { LaunchDarklyClientProvider } from "@openfeature/launchdarkly-client-provider";
import {
	type FeatureFlagsClient,
	featureFlagsClientCreate,
} from "../core/feature-flags-client.ts";
import {
	type FeatureFlagContext,
	type FeatureFlagKinds,
	featureFlagsContextFreeze,
} from "../core/feature-flags-context.ts";
import type { FeatureFlagDefinitions } from "../core/feature-flags-define.ts";
import type { FeatureFlagFallback } from "../core/feature-flags-resolve.ts";
import { featureFlagsLaunchDarklyClientSourceCreate } from "./feature-flags-launch-darkly-client-source.ts";

const readyTimeoutMsDefault = 2000;

/** What `featureFlagsLaunchDarklyClientCreate` takes. */
export type FeatureFlagsLaunchDarklyClientOptions<
	D extends FeatureFlagDefinitions,
	K extends FeatureFlagKinds,
> = {
	/** LaunchDarkly's client-side ID for the environment. It is public by design. */
	readonly clientSideId: string;
	/** The one context this client starts with. Replace it whole with `contextSet`. */
	readonly context: FeatureFlagContext<K>;
	readonly flags: D;
	readonly kinds?: K | null;
	/** Called with each fallback a read returns, to log it. A throw is ignored. */
	readonly onFallback?: ((fallback: FeatureFlagFallback) => unknown) | null;
	/** How long `ready` waits for LaunchDarkly before it settles `timeout`. Default 2000. */
	readonly readyTimeoutMs?: number | null;
	/** Extra options for LaunchDarkly's browser SDK. `streaming` is always on: live updates need it. */
	readonly vendor?: Omit<LDOptions, "streaming"> | null;
};

/** The LaunchDarkly provider, with streaming forced on so its change events reach the flags. */
export const featureFlagsLaunchDarklyClientProviderCreate = ({
	clientSideId,
	vendor,
}: {
	clientSideId: string;
	vendor?: FeatureFlagsLaunchDarklyClientOptions<
		FeatureFlagDefinitions,
		FeatureFlagKinds
	>["vendor"];
}): LaunchDarklyClientProvider =>
	new LaunchDarklyClientProvider(clientSideId, { ...vendor, streaming: true });

/**
 * Opens the browser's flags on LaunchDarkly with live updates. It never throws: until `ready`
 * settles `connected`, and whenever LaunchDarkly cannot answer, reads return each flag's declared
 * fallback. Each client has its own OpenFeature domain, so clients do not share a context.
 */
export const featureFlagsLaunchDarklyClientCreate = <
	const D extends FeatureFlagDefinitions,
	const K extends FeatureFlagKinds = Record<never, never>,
>({
	clientSideId,
	context,
	flags,
	onFallback,
	readyTimeoutMs,
	vendor,
}: FeatureFlagsLaunchDarklyClientOptions<D, K>): FeatureFlagsClient<D, K> =>
	featureFlagsClientCreate<D, K>({
		flags,
		onFallback: onFallback ?? null,
		source: featureFlagsLaunchDarklyClientSourceCreate({
			context: featureFlagsContextFreeze(context),
			domain: `feature-flags-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
			provider: featureFlagsLaunchDarklyClientProviderCreate({
				clientSideId,
				vendor,
			}),
			readyTimeoutMs: readyTimeoutMs ?? readyTimeoutMsDefault,
		}),
	});
