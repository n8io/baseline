import { describe, expect, it } from "vitest";
import { authnRequestUrlPagePath } from "./authn-request-url.ts";

describe("authnRequestUrlPagePath", () => {
	it.each([
		["https://app.test/foos", "/foos"],
		["https://app.test/foos?page=2", "/foos?page=2"],
		["https://app.test/foos.data?_routes=root", "/foos"],
		["https://app.test/foos.data?page=2&_routes=root", "/foos?page=2"],
		["https://app.test/_.data", "/"],
		["https://app.test/foos/_.data", "/foos/"],
	])("maps %s to %s", (url, path) => {
		expect(authnRequestUrlPagePath(new URL(url))).toBe(path);
	});
});
