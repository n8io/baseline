import { trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authnTestAppCreate } from "./authn-test-app.ts";
import { appOrigin } from "./authn-test-helpers.ts";
import { type Actor, authnMemoryTokenCreate } from "./index.ts";

const machine: Actor = {
	id: "foo-schedule",
	kind: "client",
	scopes: ["foo:read"],
};

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("authnMiddlewareCreate with the bearer token", () => {
	it("sets the actor from a memory-issuer token through actorFromClaims", async () => {
		const { app, authn } = await authnTestAppCreate();
		const token = await authnMemoryTokenCreate({ actor: machine, authn });
		const res = await app.request(`${appOrigin}/api/v1/me`, {
			headers: { Authorization: `Bearer ${token}` },
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toStrictEqual(machine);
	});

	it("puts only the actor's id on the request span as user.id", async () => {
		const setAttribute = vi.fn();
		vi.spyOn(trace, "getActiveSpan").mockReturnValue({
			setAttribute,
		} as unknown as ReturnType<typeof trace.getActiveSpan>);
		const { app, authn } = await authnTestAppCreate();
		const token = await authnMemoryTokenCreate({ actor: machine, authn });
		await app.request(`${appOrigin}/api/v1/me`, {
			headers: { Authorization: `Bearer ${token}` },
		});

		expect(setAttribute).toHaveBeenCalledExactlyOnceWith(
			"user.id",
			"foo-schedule",
		);
	});

	it("answers 401 AuthnRequired when a route needs an actor and none is sent", async () => {
		const { app } = await authnTestAppCreate();
		const res = await app.request(`${appOrigin}/api/v1/me`);

		expect(res.status).toBe(401);
		expect(await res.json()).toStrictEqual({
			code: "AuthnRequired",
			status: 401,
			title: "Unauthorized",
		});
	});

	it("leaves the actor undefined without a token and never rejects", async () => {
		const { app } = await authnTestAppCreate();
		const res = await app.request(`${appOrigin}/api/v1/whoami`);

		expect(await res.json()).toStrictEqual({ actor: null });
	});

	it.each([
		["a forged token", "Bearer abc.def.ghi"],
		["a malformed header", "Bearer"],
		["another scheme", "Basic dXNlcjpwYXNz"],
	])("answers 401 AuthnInvalid for %s, never anonymous", async (_, header) => {
		const { app } = await authnTestAppCreate();
		const res = await app.request(`${appOrigin}/api/v1/whoami`, {
			headers: { Authorization: header },
		});

		expect(res.status).toBe(401);
		expect(await res.json()).toMatchObject({ code: "AuthnInvalid" });
	});

	it("answers 401 AuthnInvalid for an expired token and never redirects", async () => {
		const { app, authn } = await authnTestAppCreate();
		const token = await authnMemoryTokenCreate({ actor: machine, authn });
		vi.useFakeTimers({ now: Date.now() + 16 * 60_000, toFake: ["Date"] });
		const res = await app.request(`${appOrigin}/api/v1/whoami`, {
			headers: { Authorization: `Bearer ${token}` },
		});

		expect(res.status).toBe(401);
		expect(res.headers.get("Location")).toBeNull();
	});

	it("answers 401 AuthnInvalid for a token from another memory issuer", async () => {
		const other = await authnTestAppCreate();
		const token = await authnMemoryTokenCreate({
			actor: machine,
			authn: other.authn,
		});
		const { app } = await authnTestAppCreate();
		const res = await app.request(`${appOrigin}/api/v1/whoami`, {
			headers: { Authorization: `Bearer ${token}` },
		});

		expect(res.status).toBe(401);
	});

	it("never accepts the cookie on the API", async () => {
		const { app } = await authnTestAppCreate();
		const res = await app.request(`${appOrigin}/api/v1/me`, {
			headers: { Cookie: "__Host-authn=anything" },
		});

		expect(await res.json()).toMatchObject({ code: "AuthnRequired" });
	});
});
