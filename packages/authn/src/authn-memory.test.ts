import { afterEach, describe, expect, it, vi } from "vitest";
import { authnTestAppCreate } from "./authn-test-app.ts";
import {
	appOrigin,
	authnSetCookieLine,
	authnTestCookieJarCreate,
	authnTestPageBodyRead,
} from "./authn-test-helpers.ts";
import { authnMemoryTokenCreate } from "./index.ts";

const signIn = async (who: string, returnTo = "/foos") => {
	const { app, authn } = await authnTestAppCreate();
	const jar = authnTestCookieJarCreate();
	const res = await app.request(`${appOrigin}/auth/sign-in`, {
		body: new URLSearchParams({ returnTo, who }),
		method: "POST",
	});
	jar.store(res);
	const page = (path: string, init: RequestInit = {}) =>
		app.request(`${appOrigin}${path}`, {
			...init,
			headers: { Cookie: jar.header() },
		});
	return { app, authn, jar, page, res };
};

afterEach(() => {
	vi.useRealTimers();
});

describe("memory issuer sign-in", () => {
	it("shows a dev page offering Dev user and Dev admin, keeping returnTo", async () => {
		const { app } = await authnTestAppCreate();
		const res = await app.request(
			`${appOrigin}/auth/sign-in?returnTo=%2Ffoos%3Fpage%3D2`,
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
			`${appOrigin}/auth/sign-in?returnTo=${encodeURIComponent('/x"><script>')}`,
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
		const res = await app.request(`${appOrigin}/auth/sign-in`, {
			body: new URLSearchParams({ who: "root" }),
			method: "POST",
		});

		expect(res.status).toBe(400);
	});
});

describe("cookies", () => {
	it("sets the access cookie on / and the refresh cookie on /auth, both HttpOnly, Secure and SameSite=Lax", async () => {
		const { res } = await signIn("dev-user");
		const access = authnSetCookieLine(res, "__Host-authn");
		const refresh = authnSetCookieLine(res, "__Secure-authn-refresh");

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
		const token = await authnMemoryTokenCreate({
			actor: { id: "dev-user", kind: "user", scopes: [] },
			authn,
		});

		expect(jar.get("__Host-authn")?.split(".")).toHaveLength(5);
		expect(jar.get("__Host-authn")).not.toContain(token.split(".")[0]);
	});

	it("rejects a refresh cookie moved into the access cookie", async () => {
		const { app, jar } = await signIn("dev-user");
		const res = await app.request(`${appOrigin}/foos`, {
			headers: { Cookie: `__Host-authn=${jar.get("__Secure-authn-refresh")}` },
		});

		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe("/auth/sign-in?returnTo=%2Ffoos");
	});
});

describe("authnMiddlewareCreate with the cookie", () => {
	it("leaves the actor undefined without a cookie and never rejects", async () => {
		const { app } = await authnTestAppCreate();
		const res = await app.request(`${appOrigin}/foos`);

		expect(res.status).toBe(200);
		expect(await res.json()).toStrictEqual({ actor: null, expiresAt: null });
	});

	it("clears both cookies and redirects to sign-in for an invalid cookie, never anonymous", async () => {
		const { app } = await authnTestAppCreate();
		const res = await app.request(`${appOrigin}/foos?page=2`, {
			headers: { Cookie: "__Host-authn=forged" },
		});

		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe(
			"/auth/sign-in?returnTo=%2Ffoos%3Fpage%3D2",
		);
		expect(authnSetCookieLine(res, "__Host-authn")).toMatch(/Max-Age=0/);
		expect(authnSetCookieLine(res, "__Secure-authn-refresh")).toMatch(
			/Max-Age=0/,
		);
	});

	it("treats a cookie from another AUTHN_SECRET as invalid", async () => {
		const { jar } = await signIn("dev-user");
		const { app } = await authnTestAppCreate({
			...(await import("./authn-test-helpers.ts")).memoryOptions,
			secret: Buffer.alloc(32, 9).toString("base64url"),
		});
		const res = await app.request(`${appOrigin}/foos`, {
			headers: { Cookie: jar.header() },
		});

		expect(res.headers.get("Location")).toBe("/auth/sign-in?returnTo=%2Ffoos");
	});

	it("answers a React Router data request with its document-redirect signal", async () => {
		const { app } = await authnTestAppCreate();
		const res = await app.request(`${appOrigin}/foos.data?_routes=root`, {
			headers: { Cookie: "__Host-authn=forged" },
		});

		expect(res.status).toBe(204);
		expect(res.headers.get("X-Remix-Redirect")).toBe(
			"/auth/sign-in?returnTo=%2Ffoos",
		);
		expect(res.headers.get("X-Remix-Reload-Document")).toBe("true");
	});

	it("redirects a page GET with an expiring token to /auth/refresh", async () => {
		const { page } = await signIn("dev-user");
		vi.useFakeTimers({
			now: Date.now() + 15 * 60_000 - 5_000,
			toFake: ["Date"],
		});
		const res = await page("/foos?page=2");

		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe(
			"/auth/refresh?returnTo=%2Ffoos%3Fpage%3D2",
		);
	});

	it("redirects a page GET with an expired token to /auth/refresh", async () => {
		const { page } = await signIn("dev-user");
		vi.useFakeTimers({ now: Date.now() + 60 * 60_000, toFake: ["Date"] });

		expect((await page("/foos")).headers.get("Location")).toBe(
			"/auth/refresh?returnTo=%2Ffoos",
		);
	});

	it("sends a post with an expired token to sign-in", async () => {
		const { page } = await signIn("dev-user");
		vi.useFakeTimers({ now: Date.now() + 60 * 60_000, toFake: ["Date"] });
		const res = await page("/foos", { method: "POST" });

		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe("/auth/sign-in?returnTo=%2Ffoos");
		expect(authnSetCookieLine(res, "__Host-authn")).toMatch(/Max-Age=0/);
	});

	it("never reads the cookie on the API", async () => {
		const { app, jar } = await signIn("dev-user");
		const res = await app.request(`${appOrigin}/api/v1/whoami`, {
			headers: { Cookie: jar.header() },
		});

		expect(await res.json()).toStrictEqual({ actor: null });
	});
});

describe("/auth/refresh", () => {
	it("refreshes both cookies and redirects back to returnTo", async () => {
		const { jar, page } = await signIn("dev-admin");
		vi.useFakeTimers({ now: Date.now() + 20 * 60_000, toFake: ["Date"] });
		const res = await page("/auth/refresh?returnTo=%2Ffoos");
		jar.store(res);

		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe("/foos");
		expect(authnSetCookieLine(res, "__Host-authn")).toBeDefined();
		expect(authnSetCookieLine(res, "__Secure-authn-refresh")).toBeDefined();
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

		expect((await app.request(`${appOrigin}/auth/refresh`)).status).toBe(401);
	});

	it("redirects to sign-in when there is no refresh token", async () => {
		const { app } = await authnTestAppCreate();
		const res = await app.request(`${appOrigin}/auth/refresh?returnTo=%2Ffoos`);

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
		expect(authnSetCookieLine(res, "__Host-authn")).toMatch(
			/Max-Age=0; Path=\//,
		);
		expect(authnSetCookieLine(res, "__Secure-authn-refresh")).toMatch(
			/Max-Age=0; Path=\/auth/,
		);
	});

	it("is POST only", async () => {
		const { page } = await signIn("dev-user");

		expect((await page("/auth/sign-out")).status).toBe(404);
	});
});
