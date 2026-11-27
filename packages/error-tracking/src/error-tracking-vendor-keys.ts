import { sharedVendorKeyRefused } from "@n8io/baseline-shared";

const vendorKeys = ["dist", "release", "sampleRate"] as const;

/** The vendor option keys that reach the error tracker. */
export const errorTrackingVendorKeys: readonly string[] = vendorKeys;

/** The first key of `vendor` that is not allowed, or undefined when all are. */
export const errorTrackingVendorKeyRefused = (
	vendor: object | null | undefined,
): string | undefined =>
	sharedVendorKeyRefused({ allowed: vendorKeys, vendor });
