import { describe, expect, it } from "vitest";
import { sharedVendorKeyRefused } from "./index.ts";

const allowed = ["host", "timeout"] as const;

describe("sharedVendorKeyRefused", () => {
	it("returns undefined when every key is allowed", () => {
		expect(
			sharedVendorKeyRefused({ allowed, vendor: { host: "a.example" } }),
		).toBeUndefined();
		expect(sharedVendorKeyRefused({ allowed, vendor: {} })).toBeUndefined();
	});

	it("returns the first key that is not allowed", () => {
		const fake = { host: "a.example", debug: true, dsn: "x" };

		expect(sharedVendorKeyRefused({ allowed, vendor: fake })).toBe("debug");
	});

	it("refuses nothing when there is no vendor object", () => {
		expect(
			sharedVendorKeyRefused({ allowed, vendor: undefined }),
		).toBeUndefined();
		expect(sharedVendorKeyRefused({ allowed, vendor: null })).toBeUndefined();
	});

	it("refuses every key when the allowed list is empty", () => {
		expect(
			sharedVendorKeyRefused({ allowed: [], vendor: { host: "a.example" } }),
		).toBe("host");
	});

	it("does not treat an inherited property as a key", () => {
		const fake = Object.create({ host: "a.example" }) as object;

		expect(
			sharedVendorKeyRefused({ allowed: [], vendor: fake }),
		).toBeUndefined();
	});
});
