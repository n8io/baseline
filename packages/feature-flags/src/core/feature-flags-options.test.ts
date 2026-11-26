import { describe, expect, it } from "vitest";
import { featureFlagsLaunchDarklyCreate } from "../launchdarkly/feature-flags-launch-darkly.ts";
import { featureFlagsLaunchDarklyClientCreate } from "../launchdarkly-client/feature-flags-launch-darkly-client.ts";
import {
	featureFlagsOptionsDomainCreate,
	featureFlagsOptionsStringRequire,
	featureFlagsOptionsTimeoutMsResolve,
} from "./feature-flags-options.ts";
import { featureFlagsTestDefs } from "./feature-flags-test-fixtures.ts";

describe("featureFlagsOptionsTimeoutMsResolve", () => {
	it("defaults to 2000 when left out", () => {
		expect(
			featureFlagsOptionsTimeoutMsResolve({
				factory: "f",
				readyTimeoutMs: undefined,
			}),
		).toBe(2000);
		expect(
			featureFlagsOptionsTimeoutMsResolve({
				factory: "f",
				readyTimeoutMs: null,
			}),
		).toBe(2000);
	});

	it("passes a whole number of milliseconds through", () => {
		expect(
			featureFlagsOptionsTimeoutMsResolve({ factory: "f", readyTimeoutMs: 1 }),
		).toBe(1);
		expect(
			featureFlagsOptionsTimeoutMsResolve({
				factory: "f",
				readyTimeoutMs: 2_147_483_647,
			}),
		).toBe(2_147_483_647);
	});

	it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
		"throws a TypeError on %s",
		(value) => {
			expect(() =>
				featureFlagsOptionsTimeoutMsResolve({
					factory: "f",
					readyTimeoutMs: value,
				}),
			).toThrow(TypeError);
		},
	);
});

describe("featureFlagsOptionsStringRequire", () => {
	it("throws a TypeError naming the option on an empty or blank string", () => {
		expect(() =>
			featureFlagsOptionsStringRequire({
				factory: "f",
				name: "sdkKey",
				value: "",
			}),
		).toThrow(new TypeError("f: sdkKey must be a non-empty string"));
		expect(() =>
			featureFlagsOptionsStringRequire({
				factory: "f",
				name: "sdkKey",
				value: " ",
			}),
		).toThrow(TypeError);
	});

	it("accepts a string", () => {
		expect(() =>
			featureFlagsOptionsStringRequire({
				factory: "f",
				name: "sdkKey",
				value: "sdk-1",
			}),
		).not.toThrow();
	});
});

describe("featureFlagsOptionsDomainCreate", () => {
	it("names a different domain each time", () => {
		expect(featureFlagsOptionsDomainCreate()).not.toBe(
			featureFlagsOptionsDomainCreate(),
		);
	});
});

describe("the factories", () => {
	it("throw a TypeError on an empty key or a bad readyTimeoutMs", () => {
		expect(() =>
			featureFlagsLaunchDarklyCreate({
				flags: featureFlagsTestDefs,
				sdkKey: "",
			}),
		).toThrow(TypeError);
		expect(() =>
			featureFlagsLaunchDarklyCreate({
				flags: featureFlagsTestDefs,
				readyTimeoutMs: Number.NaN,
				sdkKey: "sdk-1",
			}),
		).toThrow(TypeError);
		expect(() =>
			featureFlagsLaunchDarklyClientCreate({
				clientSideId: "",
				context: {},
				flags: featureFlagsTestDefs,
			}),
		).toThrow(TypeError);
		expect(() =>
			featureFlagsLaunchDarklyClientCreate({
				clientSideId: "id",
				context: {},
				flags: featureFlagsTestDefs,
				readyTimeoutMs: 1e12,
			}),
		).toThrow(TypeError);
	});
});
