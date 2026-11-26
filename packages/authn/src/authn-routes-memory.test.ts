import { describe, expect, it } from "vitest";
import { authnTestAppCreate } from "./authn-test-app.ts";
import { authnTestCookieForge } from "./authn-test-forge.ts";
import {
	authnTestCookieJarCreate,
	authnTestMemoryOptions,
	authnTestOrigin,
	authnTestPageBodyRead,
	authnTestSetCookieLine,
} from "./authn-test-helpers.ts";
import type { Actor } from "./index.ts";
import { authnTestTokenCreate } from "./testing.ts";

type App = Awaited<ReturnType<typeof authnTestAppCreate>>["app"];

const tokenRequest = (app: App, form: Record<string, string>) =>
	app.request(`${authnTestOrigin}/auth/token`, {
		body: new URLSearchParams(form),
		method: "POST",
	});

const whoami = async (app: App, token: string) => {
	const res = await app.request(`${authnTestOrigin}/api/v1/whoami`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	return { body: (await res.json()) as { actor: Actor | null }, res };
};

const signIn = async (who: string, returnTo = "/foos") => {
	const { app, authn } = await authnTestAppCreate();
	const jar = authnTestCookieJarCreate();
	const res = await app.request(`${authnTestOrigin}/auth/sign-in`, {
		body: new URLSearchParams({ returnTo, who }),
		method: "POST",
	});
	jar.store(res);
	const page = (path: string, init: RequestInit = {}) =>
		app.request(`${authnTestOrigin}${path}`, {
			...init,
			headers: { Cookie: jar.header() },
		});
	return { app, authn, jar, page, res };
};

const dev: Actor = { id: "dev-user", kind: "user", scopes: [] };
const admin: Actor = {
	id: "dev-admin",
	kind: "user",
	scopes: ["foo:delete", "foo:update"],
};

describe("memory issuer sign-in", () => {
	it("shows a dev page offering Dev user and Dev admin, keeping returnTo", async () => {
		const { app } = await authnTestAppCreate();
		const res = await app.request(
			`${authnTestOrigin}/auth/sign-in?returnTo=%2Ffoos%3Fpage%3D2`,
		);
		const html = await res.text();

		expect(res.status).toBe(200);
		expect(html).toContain("Dev user");
		expect(html).toContain("Dev admin");
		expect(html).toContain('name="returnTo" value="/foos?page=2"');
		// The app's CSP blocks inline styles.
		expect(html).not.toContain("style=");
		expect(res.headers.get("Cache-Control")).toBe("no-store");
	});

	it("escapes returnTo in the page", async () => {
		const { app } = await authnTestAppCreate();
		const res = await app.request(
			`${authnTestOrigin}/auth/sign-in?returnTo=${encodeURIComponent('/x"><script>')}`,
		);

		expect(await res.text()).not.toContain("<script>");
	});

	it("signs in a memoryUsers entry with its scopes through the verifier and actorFromClaims", async () => {
		const { page, res } = await signIn("dev-admin");

		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe("/foos");
		const body = await authnTestPageBodyRead(await page("/foos"));
		expect(body.actor).toStrictEqual({
			id: "dev-admin",
			kind: "user",
			scopes: ["foo:delete", "foo:update"],
		});
		expect(body.expiresAt).toBeGreaterThan(Date.now() + 14 * 60_000);
	});

	it("signs in Dev user with no scopes", async () => {
		const { page } = await signIn("dev-user");

		expect(
			(await authnTestPageBodyRead(await page("/foos"))).actor,
		).toStrictEqual({
			id: "dev-user",
			kind: "user",
			scopes: [],
		});
	});

	it("never redirects to another site after sign-in", async () => {
		const { res } = await signIn("dev-user", "//evil.example/");

		expect(res.headers.get("Location")).toBe("/");
	});

	it("refuses an unknown choice", async () => {
		const { app } = await authnTestAppCreate();
		const res = await app.request(`${authnTestOrigin}/auth/sign-in`, {
			body: new URLSearchParams({ who: "root" }),
			method: "POST",
		});

		expect(res.status).toBe(400);
	});
});

describe("cookies", () => {
	it("sets the access cookie on / and the refresh cookie on /auth, both HttpOnly, Secure and SameSite=Lax", async () => {
		const { res } = await signIn("dev-user");
		const access = authnTestSetCookieLine(res, "__Host-authn");
		const refresh = authnTestSetCookieLine(res, "__Secure-authn-refresh");

		expect(access).toMatch(/; Path=\/(;|$)/);
		expect(refresh).toMatch(/; Path=\/auth(;|$)/);
		for (const line of [access, refresh]) {
			expect(line).toContain("; HttpOnly");
			expect(line).toContain("; Secure");
			expect(line).toContain("; SameSite=Lax");
			expect(line).not.toContain("Domain=");
		}
	});

	it("encrypts the token, so the cookie never holds the JWT", async () => {
		const { authn, jar } = await signIn("dev-user");
		const token = await authnTestTokenCreate({
			actor: { id: "dev-user", kind: "user", scopes: [] },
			authn,
		});

		expect(jar.get("__Host-authn")?.split(".")).toHaveLength(5);
		expect(jar.get("__Host-authn")).not.toContain(token.split(".")[0]);
	});

	it("rejects a refresh cookie moved into the access cookie", async () => {
		const { app, jar } = await signIn("dev-user");
		const res = await app.request(`${authnTestOrigin}/foos`, {
			headers: { Cookie: `__Host-authn=${jar.get("__Secure-authn-refresh")}` },
		});

		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe("/auth/sign-in?returnTo=%2Ffoos");
	});
});

describe("authnMiddlewareCreate with the cookie", () => {
	it("leaves the actor undefined without a cookie and never rejects", async () => {
		const { app } = await authnTestAppCreate();
		const res = await app.request(`${authnTestOrigin}/foos`);

		expect(res.status).toBe(200);
		expect(await res.json()).toStrictEqual({ actor: null, expiresAt: null });
	});

	it("clears both cookies and redirects to sign-in for an invalid cookie, never anonymous", async () => {
		const { app } = await authnTestAppCreate();
		const res = await app.request(`${authnTestOrigin}/foos?page=2`, {
			headers: { Cookie: "__Host-authn=forged" },
		});

		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe(
			"/auth/sign-in?returnTo=%2Ffoos%3Fpage%3D2",
		);
		expect(authnTestSetCookieLine(res, "__Host-authn")).toMatch(/Max-Age=0/);
		expect(authnTestSetCookieLine(res, "__Secure-authn-refresh")).toMatch(
			/Max-Age=0/,
		);
	});

	it("treats a cookie from another AUTHN_SECRET as invalid", async () => {
		const { jar } = await signIn("dev-user");
		const { app } = await authnTestAppCreate({
			...(await import("./authn-test-helpers.ts")).authnTestMemoryOptions,
			secret: Buffer.alloc(32, 9).toString("base64url"),
		});
		const res = await app.request(`${authnTestOrigin}/foos`, {
			headers: { Cookie: jar.header() },
		});

		expect(res.headers.get("Location")).toBe("/auth/sign-in?returnTo=%2Ffoos");
	});

	it("answers a React Router data request with its document-redirect signal", async () => {
		const { app } = await authnTestAppCreate();
		const res = await app.request(`${authnTestOrigin}/foos.data?_routes=root`, {
			headers: { Cookie: "__Host-authn=forged" },
		});

		expect(res.status).toBe(204);
		expect(res.headers.get("X-Remix-Redirect")).toBe(
			"/auth/sign-in?returnTo=%2Ffoos",
		);
		expect(res.headers.get("X-Remix-Reload-Document")).toBe("true");
	});

	it("redirects a page GET with an expiring token to /auth/refresh", async () => {
		const { app } = await authnTestAppCreate();
		const res = await app.request(`${authnTestOrigin}/foos?page=2`, {
			// A token with 5 s left, as one 15 minutes old would have.
			headers: {
				Cookie: await authnTestCookieForge({ actor: dev, expiresInSeconds: 5 }),
			},
		});

		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe(
			"/auth/refresh?returnTo=%2Ffoos%3Fpage%3D2",
		);
	});

	it("redirects a page GET with an expired token to /auth/refresh", async () => {
		const { app } = await authnTestAppCreate();
		const res = await app.request(`${authnTestOrigin}/foos`, {
			headers: {
				Cookie: await authnTestCookieForge({
					actor: dev,
					expiresInSeconds: -60,
				}),
			},
		});

		expect(res.headers.get("Location")).toBe("/auth/refresh?returnTo=%2Ffoos");
	});

	it("sends a post with an expired token to sign-in", async () => {
		const { app } = await authnTestAppCreate();
		const res = await app.request(`${authnTestOrigin}/foos`, {
			headers: {
				Cookie: await authnTestCookieForge({
					actor: dev,
					expiresInSeconds: -60,
				}),
			},
			method: "POST",
		});

		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe("/auth/sign-in?returnTo=%2Ffoos");
		expect(authnTestSetCookieLine(res, "__Host-authn")).toMatch(/Max-Age=0/);
	});

	it("never reads the cookie on the API", async () => {
		const { app, jar } = await signIn("dev-user");
		const res = await app.request(`${authnTestOrigin}/api/v1/whoami`, {
			headers: { Cookie: jar.header() },
		});

		expect(await res.json()).toStrictEqual({ actor: null });
	});
});

describe("/auth/refresh", () => {
	it("refreshes both cookies and redirects back to returnTo", async () => {
		const { app, jar, page } = await signIn("dev-admin");
		// The access token has lapsed; the refresh cookie still holds.
		const res = await app.request(
			`${authnTestOrigin}/auth/refresh?returnTo=%2Ffoos`,
			{
				headers: {
					Cookie: await authnTestCookieForge({
						actor: admin,
						expiresInSeconds: -60,
						keep: jar.header(),
					}),
				},
			},
		);
		jar.store(res);

		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe("/foos");
		expect(authnTestSetCookieLine(res, "__Host-authn")).toBeDefined();
		expect(authnTestSetCookieLine(res, "__Secure-authn-refresh")).toBeDefined();
		const body = await authnTestPageBodyRead(await page("/foos"));
		expect(body.actor?.id).toBe("dev-admin");
		expect(body.expiresAt).toBeGreaterThan(Date.now() + 14 * 60_000);
	});

	it("answers the client's fetch with the new expiry", async () => {
		const { page } = await signIn("dev-user");
		const res = await page("/auth/refresh");

		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toBe("no-store");
		expect(
			((await res.json()) as { expiresAt: number }).expiresAt,
		).toBeGreaterThan(Date.now());
	});

	it("answers the client's fetch 401 without a refresh cookie", async () => {
		const { app } = await authnTestAppCreate();

		expect((await app.request(`${authnTestOrigin}/auth/refresh`)).status).toBe(
			401,
		);
	});

	it("redirects to sign-in when there is no refresh token", async () => {
		const { app } = await authnTestAppCreate();
		const res = await app.request(
			`${authnTestOrigin}/auth/refresh?returnTo=%2Ffoos`,
		);

		expect(res.headers.get("Location")).toBe("/auth/sign-in?returnTo=%2Ffoos");
	});

	it("never redirects to another site", async () => {
		const { page } = await signIn("dev-user");

		expect(
			(
				await page("/auth/refresh?returnTo=https%3A%2F%2Fevil.example")
			).headers.get("Location"),
		).toBe("/");
	});
});

describe("/auth/sign-out", () => {
	it("clears both cookies and redirects home on POST", async () => {
		const { page } = await signIn("dev-user");
		const res = await page("/auth/sign-out", { method: "POST" });

		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe("/");
		expect(authnTestSetCookieLine(res, "__Host-authn")).toMatch(
			/Max-Age=0; Path=\//,
		);
		expect(authnTestSetCookieLine(res, "__Secure-authn-refresh")).toMatch(
			/Max-Age=0; Path=\/auth/,
		);
	});

	it("is POST only", async () => {
		const { page } = await signIn("dev-user");

		expect((await page("/auth/sign-out")).status).toBe(404);
	});
});

describe("memory users", () => {
	it("lists each user with its scopes on the sign-in page, escaped", async () => {
		const { app } = await authnTestAppCreate({
			...authnTestMemoryOptions,
			memoryUsers: [
				{ id: "commish", name: "Commissioner <3", scopes: ["league:manage"] },
				{ id: "player", name: "Player", scopes: [] },
			],
		});
		const html = await (
			await app.request(`${authnTestOrigin}/auth/sign-in`)
		).text();

		expect(html).toContain('name="who" value="commish"');
		expect(html).toContain("Commissioner &lt;3");
		expect(html).toContain("league:manage");
		expect(html).toContain('name="who" value="player"');
		expect(html).toContain("no scopes");
	});

	it("offers one Dev user without scopes when memoryUsers is not set", async () => {
		const { memoryUsers, ...options } = authnTestMemoryOptions;
		const { app } = await authnTestAppCreate(options);
		const html = await (
			await app.request(`${authnTestOrigin}/auth/sign-in`)
		).text();

		expect(html.match(/name="who"/g)).toHaveLength(1);
		expect(html).toContain('value="dev-user"');
	});
});

describe("POST /auth/token, client credentials", () => {
	it("signs a client token with all of the client's scopes by default", async () => {
		const { app } = await authnTestAppCreate();
		const res = await tokenRequest(app, {
			client_id: "feed",
			grant_type: "client_credentials",
		});
		const body = (await res.json()) as Record<string, unknown>;

		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toBe("no-store");
		expect(body).toMatchObject({ expires_in: 900, token_type: "Bearer" });
		expect(
			(await whoami(app, String(body["access_token"]))).body.actor,
		).toStrictEqual({
			id: "feed",
			kind: "client",
			scopes: ["foo:read", "foo:update"],
		});
	});

	it("narrows to a requested subset of the client's scopes", async () => {
		const { app } = await authnTestAppCreate();
		const res = await tokenRequest(app, {
			client_id: "feed",
			grant_type: "client_credentials",
			scope: "foo:read",
		});
		const { access_token } = (await res.json()) as { access_token: string };

		expect((await whoami(app, access_token)).body.actor?.scopes).toStrictEqual([
			"foo:read",
		]);
	});

	it("answers 400 invalid_scope for a scope the client does not have", async () => {
		const { app } = await authnTestAppCreate();
		const res = await tokenRequest(app, {
			client_id: "feed",
			grant_type: "client_credentials",
			scope: "foo:read foo:delete",
		});

		expect(res.status).toBe(400);
		expect(await res.json()).toStrictEqual({ error: "invalid_scope" });
	});

	it("answers 401 invalid_client for an unknown client, such as a user's id", async () => {
		const { app } = await authnTestAppCreate();
		const res = await tokenRequest(app, {
			client_id: "dev-admin",
			grant_type: "client_credentials",
		});

		expect(res.status).toBe(401);
		expect(await res.json()).toStrictEqual({ error: "invalid_client" });
	});

	it("answers 400 unsupported_grant_type for another grant type", async () => {
		const { app } = await authnTestAppCreate();
		const res = await tokenRequest(app, {
			client_id: "feed",
			grant_type: "password",
		});

		expect(res.status).toBe(400);
		expect(await res.json()).toStrictEqual({
			error: "unsupported_grant_type",
		});
	});
});
