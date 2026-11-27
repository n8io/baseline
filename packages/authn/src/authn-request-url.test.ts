import { describe, expect, it } from "vitest";
import {
	authnRequestUrlPagePath,
	authnRequestUrlPublic,
} from "./authn-request-url.ts";

describe("authnRequestUrlPagePath", () => {
	it.each([
		["https://app.test/foos", "/foos"],
		["https://app.test/foos?page=2", "/foos?page=2"],
		["https://app.test/foos.data?_routes=root", "/foos"],
		["https://app.test/foos.data?page=2&_routes=root", "/foos?page=2"],
		["https://app.test/_.data", "/"],
		["https://app.test/foos/_.data", "/foos/"],
		["https://app.test/a.data/b.data", "/a.data/b"],
		["https://app.test/_.data/_.data", "/_.data/"],
		["https://app.test/foos.data.json", "/foos.data.json"],
	])("maps %s to %s", (url, path) => {
		expect(authnRequestUrlPagePath(new URL(url))).toBe(path);
	});
});

describe("authnRequestUrlPublic", () => {
	it("keeps the request's protocol without a TLS proxy", () => {
		const url = authnRequestUrlPublic(new Request("http://app.test/x"), "/cb");

		expect(url.href).toBe("http://app.test/cb");
	});

	it("keeps the request's protocol for any other forwarded value", () => {
		const url = authnRequestUrlPublic(
			new Request("http://app.test/x", {
				headers: { "X-Forwarded-Proto": "http" },
			}),
			"/cb",
		);

		expect(url.href).toBe("http://app.test/cb");
	});

	it("uses https when a TLS proxy says so", () => {
		const url = authnRequestUrlPublic(
			new Request("http://app.test/x", {
				headers: { "X-Forwarded-Proto": "https" },
			}),
			"/cb",
		);

		expect(url.href).toBe("https://app.test/cb");
	});
});
