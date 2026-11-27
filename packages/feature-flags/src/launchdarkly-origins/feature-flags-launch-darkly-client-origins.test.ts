import { describe, expect, it } from "vitest";
import { featureFlagsLaunchDarklyClientOrigins } from "./feature-flags-launch-darkly-client-origins.ts";

describe("featureFlagsLaunchDarklyClientOrigins", () => {
	it("names the three LaunchDarkly endpoints by default", () => {
		expect(featureFlagsLaunchDarklyClientOrigins()).toEqual([
			"https://clientsdk.launchdarkly.com",
			"https://clientstream.launchdarkly.com",
			"https://events.launchdarkly.com",
		]);
	});

	it("follows the vendor's own endpoints, keeping the rest", () => {
		expect(
			featureFlagsLaunchDarklyClientOrigins({
				vendor: { streamUri: "https://relay.example.com:8030/stream" },
			}),
		).toEqual([
			"https://clientsdk.launchdarkly.com",
			"https://relay.example.com:8030",
			"https://events.launchdarkly.com",
		]);
	});

	it("lists a relay that serves all three once", () => {
		const relay = "https://relay.example.com";
		expect(
			featureFlagsLaunchDarklyClientOrigins({
				vendor: { baseUri: relay, eventsUri: relay, streamUri: relay },
			}),
		).toEqual([relay]);
	});

	it("keeps an http origin, and leaves out a scheme that is not http or https", () => {
		expect(
			featureFlagsLaunchDarklyClientOrigins({
				vendor: {
					baseUri: "http://localhost:8030/base",
					eventsUri: "ftp://files.example.com",
					streamUri: "file:///tmp/stream",
				},
			}),
		).toEqual(["http://localhost:8030"]);
	});

	it("leaves out an option that is not an http(s) URL, such as a bare host:port", () => {
		expect(
			featureFlagsLaunchDarklyClientOrigins({
				vendor: { baseUri: "nope", eventsUri: "localhost:8030" },
			}),
		).toEqual(["https://clientstream.launchdarkly.com"]);
	});
});
