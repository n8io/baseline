// Feature flags for an entry point: LaunchDarkly with an SDK key, else every flag answers its
// declared fallback, so code never asks whether flags are on. `pnpm piece-remove feature-flags`
// deletes this file.
import type { Actor } from "@n8io/baseline-authn";
import {
	type FeatureFlags,
	type FeatureFlagsHandle,
	featureFlagsFallbackCreate,
} from "@n8io/baseline-feature-flags";
import {
	type FeatureFlagsLaunchDarklyVendorOptions,
	featureFlagsLaunchDarklyCreate,
} from "@n8io/baseline-feature-flags/launchdarkly";
import { flagDefs, flagKinds } from "./flags.ts";
import { type ShutdownSteps, shutdownStepAdd } from "./shutdown-step-add.ts";

export type AppFeatureFlags = FeatureFlags<typeof flagDefs, typeof flagKinds>;

// The steps it returns add one that closes the connection to LaunchDarkly. Boot never waits for
// it: until `ready` settles, every flag reads as its fallback.
export const featureFlagsOpen = ({
	sdkKey,
	steps,
	vendor,
}: {
	sdkKey?: string | null;
	steps: ShutdownSteps;
	// LaunchDarkly's own SDK options, set here and nowhere else.
	vendor?: FeatureFlagsLaunchDarklyVendorOptions | null;
}): { featureFlags: AppFeatureFlags; steps: ShutdownSteps } => {
	if (!sdkKey) {
		return {
			featureFlags: featureFlagsFallbackCreate({
				flags: flagDefs,
				kinds: flagKinds,
			}),
			steps,
		};
	}
	const featureFlags = featureFlagsLaunchDarklyCreate({
		flags: flagDefs,
		kinds: flagKinds,
		sdkKey,
		vendor: vendor ?? null,
	});
	return {
		featureFlags,
		steps: shutdownStepAdd({
			at: "last",
			group: "resources",
			step: { close: () => featureFlags.close(), name: "feature flags" },
			steps,
		}),
	};
};

// The flags for one request's Actor. Build it per request and drop it: a context is complete and
// never kept or merged.
export const featureFlagsForActor = ({
	actor,
	featureFlags,
}: {
	actor: Actor;
	featureFlags: AppFeatureFlags;
}): FeatureFlagsHandle<typeof flagDefs> =>
	featureFlags.context({ actor: { id: actor.id } });
