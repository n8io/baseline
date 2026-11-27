/**
 * The first key of `vendor` that `allowed` does not list, or undefined when every key is listed.
 * A missing `vendor` has no keys, so it refuses nothing. Each Package passes its own list and
 * words its own error, so this names no vendor.
 */
export const sharedVendorKeyRefused = ({
	allowed,
	vendor,
}: {
	allowed: readonly string[];
	vendor: object | null | undefined;
}): string | undefined =>
	Object.keys(vendor ?? {}).find((key) => !allowed.includes(key));
