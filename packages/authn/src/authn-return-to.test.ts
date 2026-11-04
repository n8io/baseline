import { describe, expect, it } from "vitest";
import { authnPagePath, authnReturnToSafe } from "./authn-return-to.ts";

describe("authnReturnToSafe", () => {
	it.each(["/", "/foos", "/foos/foo_1?tab=2#x"])(
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

describe("authnPagePath", () => {
	it.each([
		["https://app.test/foos", "/foos"],
		["https://app.test/foos?page=2", "/foos?page=2"],
		["https://app.test/foos.data?_routes=root", "/foos"],
		["https://app.test/foos.data?page=2&_routes=root", "/foos?page=2"],
		["https://app.test/_.data", "/"],
		["https://app.test/foos/_.data", "/foos/"],
	])("maps %s to %s", (url, path) => {
		expect(authnPagePath(new URL(url))).toBe(path);
	});
});
