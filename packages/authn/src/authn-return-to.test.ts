import { describe, expect, it } from "vitest";
import { authnReturnToSafe } from "./authn-return-to.ts";

describe("authnReturnToSafe", () => {
	it.each(["/", "/foos", "/foos/foo_1?tab=2#x", "/a b"])(
		"keeps the path %s",
		(path) => {
			expect(authnReturnToSafe(path)).toBe(path);
		},
	);

	it.each([
		undefined,
		"",
		"foos",
		"https://evil.example",
		"//evil.example",
		"/\\evil.example",
		"/\t/evil.example",
		"/\n/evil.example",
		"javascript:alert(1)",
	])("replaces %j with /", (returnTo) => {
		expect(authnReturnToSafe(returnTo)).toBe("/");
	});
});
