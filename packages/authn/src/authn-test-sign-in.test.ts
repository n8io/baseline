import { afterEach, describe, expect, it, vi } from "vitest";
import { authnTestAppCreate } from "./authn-test-app.ts";
import { appOrigin, secret } from "./authn-test-helpers.ts";
import { authnTestSignIn } from "./testing.ts";

// Routes the helper's fetch to an in-process app, so no port is opened.
const appServe = async () => {
	const { app } = await authnTestAppCreate();
	const requests: Request[] = [];
	vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
		const request = new Request(input, init);
		requests.push(request);
		return app.request(request);
	});
	return { app, requests };
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("authnTestSignIn", () => {
	it("signs in through the memory issuer's form and opens the access cookie", async () => {
		const { app, requests } = await appServe();

		const signedIn = await authnTestSignIn({
			secret,
			url: appOrigin,
			who: "dev-admin",
		});

		expect(requests.map((request) => request.headers.get("origin"))).toEqual([
			appOrigin,
		]);
		expect(signedIn.token.split(".")).toHaveLength(3);
		expect(signedIn.authorization).toBe(`Bearer ${signedIn.token}`);
		expect(signedIn.accessCookie.split(".")).toHaveLength(5);
		expect(signedIn.cookie).toContain(`__Host-authn=${signedIn.accessCookie}`);
		expect(signedIn.cookie).toContain("__Secure-authn-refresh=");
		const api = await app.request(`${appOrigin}/api/v1/me`, {
			headers: { Authorization: signedIn.authorization },
		});
		expect(await api.json()).toMatchObject({
			id: "dev-admin",
			scopes: ["foo:delete", "foo:update"],
		});
		const page = await app.request(`${appOrigin}/foos`, {
			headers: { Cookie: signedIn.cookie },
		});
		expect(await page.json()).toMatchObject({ actor: { id: "dev-admin" } });
	});

	it("signs in the dev user when asked", async () => {
		const { app } = await appServe();

		const { authorization } = await authnTestSignIn({
			secret,
			url: appOrigin,
			who: "dev-user",
		});

		const api = await app.request(`${appOrigin}/api/v1/me`, {
			headers: { Authorization: authorization },
		});
		expect(await api.json()).toMatchObject({ id: "dev-user", scopes: [] });
	});

	it("throws with the status when the server does not sign in", async () => {
		vi.stubGlobal("fetch", async () => new Response(null, { status: 403 }));

		await expect(
			authnTestSignIn({ secret, url: appOrigin, who: "dev-user" }),
		).rejects.toThrow("sign-in failed: 403");
	});

	it("throws when the secret is not the server's", async () => {
		await appServe();

		await expect(
			authnTestSignIn({
				secret: Buffer.alloc(32, 9).toString("base64url"),
				url: appOrigin,
				who: "dev-user",
			}),
		).rejects.toThrow("the access cookie did not open with this secret");
	});
});
