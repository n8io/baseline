import { ErrorCode } from "@openfeature/server-sdk";
import { describe, expect, it } from "vitest";
import { featureFlagsLaunchDarklyRead } from "./feature-flags-launch-darkly-read.ts";

describe("featureFlagsLaunchDarklyRead", () => {
	it("returns the value with its reason and variant when there is no error", () => {
		expect(
			featureFlagsLaunchDarklyRead({
				reason: "TARGETING_MATCH",
				value: 3,
				variant: "small",
			}),
		).toStrictEqual({
			found: true,
			reason: "TARGETING_MATCH",
			value: 3,
			variant: "small",
		});
	});

	it("returns null for a reason and a variant the service left out", () => {
		expect(featureFlagsLaunchDarklyRead({ value: false })).toStrictEqual({
			found: true,
			reason: null,
			value: false,
			variant: null,
		});
	});

	it("reads FLAG_NOT_FOUND as notFound and TYPE_MISMATCH as wrongType", () => {
		expect(
			featureFlagsLaunchDarklyRead({
				errorCode: ErrorCode.FLAG_NOT_FOUND,
				value: 1,
			}),
		).toStrictEqual({ found: false, reason: "notFound" });
		expect(
			featureFlagsLaunchDarklyRead({
				errorCode: ErrorCode.TYPE_MISMATCH,
				value: 1,
			}),
		).toStrictEqual({ found: false, reason: "wrongType" });
	});

	it("reads any other error as a vendor error", () => {
		expect(
			featureFlagsLaunchDarklyRead({ errorCode: ErrorCode.GENERAL, value: 1 }),
		).toStrictEqual({ found: false, reason: "vendorError" });
		expect(
			featureFlagsLaunchDarklyRead({
				errorCode: ErrorCode.PARSE_ERROR,
				value: 1,
			}),
		).toStrictEqual({ found: false, reason: "vendorError" });
	});
});
