import { describe, expect, it } from "vitest";
import {
	errorTrackingVendorKeyRefused,
	errorTrackingVendorKeys,
} from "./error-tracking-vendor-keys.ts";

describe("errorTrackingVendorKeyRefused", () => {
	it("names the first key that is not allowed", () => {
		expect(
			errorTrackingVendorKeyRefused({ dist: "1", debug: true, dsn: "x" }),
		).toBe("debug");
	});

	it.each([undefined, null, {}, { dist: "1", release: "r", sampleRate: 1 }])(
		"allows %j",
		(vendor) => {
			expect(errorTrackingVendorKeyRefused(vendor)).toBeUndefined();
		},
	);

	it("lists the allowed keys", () => {
		expect(errorTrackingVendorKeys).toEqual(["dist", "release", "sampleRate"]);
	});
});
