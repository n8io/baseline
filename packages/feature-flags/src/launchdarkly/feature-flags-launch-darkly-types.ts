import type { LDOptions } from "@launchdarkly/node-server-sdk";
import type { FeatureFlagKinds } from "../core/feature-flags-context.ts";
import type { FeatureFlagDefinitions } from "../core/feature-flags-define-types.ts";
import type { FeatureFlagsOnFallback } from "../core/feature-flags-resolve-types.ts";

/**
 * LaunchDarkly's own SDK options, named as its SDK names them. Outside this Package's contract:
 * moving off LaunchDarkly deletes it. Examples: `baseUri`, `logger`, `proxyOptions`.
 */
export type FeatureFlagsLaunchDarklyVendorOptions = LDOptions;

/** What `featureFlagsLaunchDarklyCreate` takes. */
export type FeatureFlagsLaunchDarklyOptions<
	D extends FeatureFlagDefinitions,
	K extends FeatureFlagKinds,
> = {
	readonly flags: D;
	/** The kinds a context can hold. Each needs a context kind of the same name in LaunchDarkly. */
	readonly kinds?: K | null;
	/** Receives each fallback a read returns. Defaults to logging it as a warning. */
	readonly onFallback?: FeatureFlagsOnFallback | null;
	/** How long `ready` waits for LaunchDarkly before it settles `timeout`. Default 2000. A value that is not a whole number of milliseconds from 1 up throws a `TypeError`. */
	readonly readyTimeoutMs?: number | null;
	/** The LaunchDarkly server SDK key, for the environment the process runs in. An empty one throws a `TypeError`. */
	readonly sdkKey: string;
	/** Settings only LaunchDarkly has, passed to its SDK. */
	readonly vendor?: FeatureFlagsLaunchDarklyVendorOptions | null;
};
