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

	it("throws the same TypeError for a value that is not a string", () => {
		expect(() =>
			featureFlagsOptionsStringRequire({
				factory: "f",
				name: "sdkKey",
				value: 5,
			}),
		).toThrow(new TypeError("f: sdkKey must be a non-empty string"));
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

	it("names it feature-flags, a time, a count that goes up by one, and a random word", () => {
		const parts = (name: string) => name.split("-");
		const first = parts(featureFlagsOptionsDomainCreate());
		const second = parts(featureFlagsOptionsDomainCreate());
		expect(first).toHaveLength(5);
		expect(first.slice(0, 2)).toEqual(["feature", "flags"]);
		expect(first[4]).toMatch(/^[0-9a-z]+$/);
		expect(Number.parseInt(second[3] ?? "", 36)).toBe(
			Number.parseInt(first[3] ?? "", 36) + 1,
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
		).toThrow(
			new TypeError(
				"featureFlagsLaunchDarklyCreate: sdkKey must be a non-empty string",
			),
		);
		expect(() =>
			featureFlagsLaunchDarklyCreate({
				flags: featureFlagsTestDefs,
				readyTimeoutMs: Number.NaN,
				sdkKey: "sdk-1",
			}),
		).toThrow(
			"featureFlagsLaunchDarklyCreate: readyTimeoutMs must be a whole number from 1 to 2147483647, found NaN",
		);
		expect(() =>
			featureFlagsLaunchDarklyClientCreate({
				clientSideId: "",
				context: {},
				flags: featureFlagsTestDefs,
			}),
		).toThrow(
			new TypeError(
				"featureFlagsLaunchDarklyClientCreate: clientSideId must be a non-empty string",
			),
		);
		expect(() =>
			featureFlagsLaunchDarklyClientCreate({
				clientSideId: "id",
				context: {},
				flags: featureFlagsTestDefs,
				readyTimeoutMs: 1e12,
			}),
		).toThrow(
			"featureFlagsLaunchDarklyClientCreate: readyTimeoutMs must be a whole number from 1 to 2147483647, found 1000000000000",
		);
	});
});
