import type { FeatureFlagKinds } from "../core/feature-flags-context.ts";
import type { FeatureFlagDefinitions } from "../core/feature-flags-define.ts";
import type { FeatureFlagsLaunchDarklyClientOptions } from "./feature-flags-launch-darkly-client.ts";

// LaunchDarkly's own endpoints, which the browser SDK uses unless `vendor` names others.
const originsDefault = {
	baseUri: "https://clientsdk.launchdarkly.com",
	eventsUri: "https://events.launchdarkly.com",
	streamUri: "https://clientstream.launchdarkly.com",
} as const;

/**
 * The origins the browser reaches for flag values, the live stream and events: LaunchDarkly's own
 * unless `vendor` sets `baseUri`, `streamUri` or `eventsUri` (a relay, or the EU or federal
 * endpoints). Put them in the page's Content Security Policy `connect-src`: without them the
 * browser blocks every request and each flag reads as its fallback. An unparseable option is left
 * out, since the browser could not use it either.
 */
export const featureFlagsLaunchDarklyClientOrigins = ({
	vendor,
}: {
	vendor?: FeatureFlagsLaunchDarklyClientOptions<
		FeatureFlagDefinitions,
		FeatureFlagKinds
	>["vendor"];
} = {}): readonly string[] => {
	const urls = [
		vendor?.baseUri ?? originsDefault.baseUri,
		vendor?.streamUri ?? originsDefault.streamUri,
		vendor?.eventsUri ?? originsDefault.eventsUri,
	];
	return [
		...new Set(
			urls.flatMap((url) => (URL.canParse(url) ? [new URL(url).origin] : [])),
		),
	];
};
