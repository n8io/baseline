import { describe, expect, it } from "vitest";
import { authnTestAppCreate } from "./authn-test-app.ts";
import { authnTestOrigin, authnTestSecret } from "./authn-test-helpers.ts";
import { authnTestSignIn } from "./testing.ts";

// Routes the helper's fetch to an in-process app, so no port is opened.
const appServe = async () => {
	const { app } = await authnTestAppCreate();
	const requests: Request[] = [];
	const fetchApp = async (
		input: string | URL | Request,
		init?: RequestInit,
	) => {
		const request = new Request(input, init);
		requests.push(request);
		return app.request(request);
	};
	return { app, fetchApp, requests };
};

describe("authnTestSignIn", () => {
	it("signs in through the memory issuer's form and opens the access cookie", async () => {
		const { app, fetchApp, requests } = await appServe();

		const signedIn = await authnTestSignIn({
			fetch: fetchApp,
			secret: authnTestSecret,
			baseUrl: authnTestOrigin,
			who: "dev-admin",
		});

		expect(requests.map((request) => request.headers.get("origin"))).toEqual([
			authnTestOrigin,
		]);
		expect(signedIn.token.split(".")).toHaveLength(3);
		expect(signedIn.authorization).toBe(`Bearer ${signedIn.token}`);
		expect(signedIn.accessCookie.split(".")).toHaveLength(5);
		expect(signedIn.cookie).toContain(`__Host-authn=${signedIn.accessCookie}`);
		expect(signedIn.cookie).toContain("__Secure-authn-refresh=");
		const api = await app.request(`${authnTestOrigin}/api/v1/me`, {
			headers: { Authorization: signedIn.authorization },
		});
		expect(await api.json()).toMatchObject({
			id: "dev-admin",
			scopes: ["foo:delete", "foo:update"],
		});
		const page = await app.request(`${authnTestOrigin}/foos`, {
			headers: { Cookie: signedIn.cookie },
		});
		expect(await page.json()).toMatchObject({ actor: { id: "dev-admin" } });
	});

	it("signs in the dev user when asked", async () => {
		const { app, fetchApp } = await appServe();

		const { authorization } = await authnTestSignIn({
			fetch: fetchApp,
			secret: authnTestSecret,
			baseUrl: authnTestOrigin,
			who: "dev-user",
		});

		const api = await app.request(`${authnTestOrigin}/api/v1/me`, {
			headers: { Authorization: authorization },
		});
		expect(await api.json()).toMatchObject({ id: "dev-user", scopes: [] });
	});

	it("throws with the status when the server does not sign in", async () => {
		await expect(
			authnTestSignIn({
				fetch: async () => new Response(null, { status: 403 }),
				secret: authnTestSecret,
				baseUrl: authnTestOrigin,
				who: "dev-user",
			}),
		).rejects.toThrow(
			`authnTestSignIn: POST ${authnTestOrigin}/auth/sign-in answered 403`,
		);
	});

	it("throws when the secret is not the server's", async () => {
		const { fetchApp } = await appServe();

		await expect(
			authnTestSignIn({
				fetch: fetchApp,
				secret: Buffer.alloc(32, 9).toString("base64url"),
				baseUrl: authnTestOrigin,
				who: "dev-user",
			}),
		).rejects.toThrow(
			"authnTestSignIn: the access cookie did not open with secret",
		);
	});
});
