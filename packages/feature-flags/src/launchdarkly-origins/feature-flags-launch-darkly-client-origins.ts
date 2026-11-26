import type { FeatureFlagsLaunchDarklyClientVendorOptions } from "../launchdarkly-client/feature-flags-launch-darkly-client.ts";

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
	vendor?: FeatureFlagsLaunchDarklyClientVendorOptions | null;
} = {}): readonly string[] => {
	const urls = [
		vendor?.baseUri ?? originsDefault.baseUri,
		vendor?.streamUri ?? originsDefault.streamUri,
		vendor?.eventsUri ?? originsDefault.eventsUri,
	];
	return [
		...new Set(
			urls.flatMap((url) => {
				// A scheme-less "host:8030" parses with the scheme "host:" and has no origin.
				const parsed = URL.canParse(url) ? new URL(url) : null;
				return parsed?.protocol === "https:" || parsed?.protocol === "http:"
					? [parsed.origin]
					: [];
			}),
		),
	];
};
