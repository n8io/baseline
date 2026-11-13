import { logger } from "@n8io/baseline-logger";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authnTestAppCreate } from "./authn-test-app.ts";
import {
	appOrigin,
	authnSetCookieLine,
	authnTestActorFromClaims,
	authnTestCookieJarCreate,
	authnTestPageBodyRead,
	type CookieJar,
	secret,
} from "./authn-test-helpers.ts";
import {
	authnTestOidcProviderCreate,
	type FakeProvider,
	idpOrigin,
} from "./authn-test-oidc-provider.ts";

const oidcOptions = {
	actorFromClaims: authnTestActorFromClaims,
	audience: "api",
	clientId: "app-client",
	clientSecret: "app-secret",
	issuerUrl: idpOrigin,
	secret,
};

let provider: FakeProvider;

beforeEach(async () => {
	provider = await authnTestOidcProviderCreate(oidcOptions.clientId);
	const realFetch = globalThis.fetch;
	vi.stubGlobal(
		"fetch",
		(input: string | URL | Request, init?: RequestInit) => {
			const request = new Request(input, init);
			if (!request.url.startsWith(idpOrigin)) return realFetch(request);
			if (provider.options.down)
				return Promise.reject(new TypeError("fetch failed"));
			return Promise.resolve(provider.app.fetch(request));
		},
	);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const signInStart = async (app: Hono, returnTo = "/foos") => {
	const jar = authnTestCookieJarCreate();
	const res = await app.request(
		`${appOrigin}/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`,
	);
	jar.store(res);
	return { authorizeUrl: res.headers.get("Location") ?? "", jar, res };
};

const signIn = async (app: Hono) => {
	const { authorizeUrl, jar } = await signInStart(app);
	const state = new URL(authorizeUrl).searchParams.get("state") ?? "";
	const code = provider.authorize(authorizeUrl);
	const res = await app.request(
		`${appOrigin}/auth/callback?code=${code}&state=${state}&iss=${encodeURIComponent(idpOrigin)}`,
		{ headers: { Cookie: jar.header() } },
	);
	jar.store(res);
	return { jar, res };
};

describe("OIDC sign-in", () => {
	it("redirects to the provider with PKCE, state, nonce and offline_access", async () => {
		const { app } = await authnTestAppCreate(oidcOptions);
		const { authorizeUrl, res } = await signInStart(app);
		const params = new URL(authorizeUrl).searchParams;

		expect(res.status).toBe(302);
		expect(authorizeUrl.startsWith(`${idpOrigin}/authorize?`)).toBe(true);
		expect(params.get("client_id")).toBe("app-client");
		expect(params.get("response_type")).toBe("code");
		expect(params.get("code_challenge_method")).toBe("S256");
		expect(params.get("code_challenge")).toMatch(/^[\w-]{43}$/);
		expect(params.get("state")).toBeTruthy();
		expect(params.get("nonce")).toBeTruthy();
		expect(params.get("scope")).toBe("openid offline_access");
		expect(params.get("redirect_uri")).toBe(`${appOrigin}/auth/callback`);
	});

	it("scopes the flow cookie to /auth/callback for 10 minutes", async () => {
		const { app } = await authnTestAppCreate(oidcOptions);
		const { res } = await signInStart(app);
		const line = authnSetCookieLine(res, "__Secure-authn-flow");

		expect(line).toContain("Max-Age=600");
		expect(line).toContain("Path=/auth/callback");
		expect(line).toContain("HttpOnly");
		expect(line).toContain("Secure");
		expect(line).toContain("SameSite=Lax");
	});

	it("passes authorizeParams, such as Auth0's audience", async () => {
		const { app } = await authnTestAppCreate({
			...oidcOptions,
			authorizeParams: { audience: "https://api.example" },
		});
		const { authorizeUrl } = await signInStart(app);

		expect(new URL(authorizeUrl).searchParams.get("audience")).toBe(
			"https://api.example",
		);
	});

	it("builds the https redirect_uri behind a TLS proxy", async () => {
		const { app } = await authnTestAppCreate(oidcOptions);
		const res = await app.request("http://app.test/auth/sign-in", {
			headers: { "X-Forwarded-Proto": "https" },
		});

		expect(
			new URL(res.headers.get("Location") ?? "").searchParams.get(
				"redirect_uri",
			),
		).toBe(`${appOrigin}/auth/callback`);
	});

	it("exchanges the code, sets both cookies, clears the flow cookie and returns", async () => {
		const { app } = await authnTestAppCreate(oidcOptions);
		const { jar, res } = await signIn(app);

		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe("/foos");
		expect(authnSetCookieLine(res, "__Secure-authn-flow")).toMatch(/Max-Age=0/);
		const page = await app.request(`${appOrigin}/foos`, {
			headers: { Cookie: jar.header() },
		});
		expect((await authnTestPageBodyRead(page)).actor).toStrictEqual({
			id: "user-1",
			kind: "user",
			scopes: ["foo:read"],
		});
	});

	it("shows the failure page when state does not match", async () => {
		const { app } = await authnTestAppCreate(oidcOptions);
		const { authorizeUrl, jar } = await signInStart(app);
		const code = provider.authorize(authorizeUrl);
		vi.spyOn(logger, "warn").mockImplementation(() => undefined);
		const res = await app.request(
			`${appOrigin}/auth/callback?code=${code}&state=wrong`,
			{
				headers: { Cookie: jar.header() },
			},
		);

		expect(res.status).toBe(400);
		expect(await res.text()).toContain("Sign-in failed");
		expect(authnSetCookieLine(res, "__Host-authn")).toBeUndefined();
	});

	it("shows the failure page when the provider refuses", async () => {
		const { app } = await authnTestAppCreate(oidcOptions);
		const { authorizeUrl, jar } = await signInStart(app);
		const state = new URL(authorizeUrl).searchParams.get("state") ?? "";
		vi.spyOn(logger, "warn").mockImplementation(() => undefined);
		const res = await app.request(
			`${appOrigin}/auth/callback?error=access_denied&state=${state}`,
			{ headers: { Cookie: jar.header() } },
		);

		expect(res.status).toBe(400);
		expect(await res.text()).not.toContain("access_denied");
	});

	it("shows the failure page without the flow cookie", async () => {
		const { app } = await authnTestAppCreate(oidcOptions);
		const res = await app.request(`${appOrigin}/auth/callback?code=x&state=y`);

		expect(res.status).toBe(400);
	});

	it("refuses an access token for another audience", async () => {
		provider.options.accessAudience = "someone-else";
		const { app } = await authnTestAppCreate(oidcOptions);
		const { res } = await signIn(app);

		expect(res.status).toBe(400);
		expect(authnSetCookieLine(res, "__Host-authn")).toBeUndefined();
	});

	it("clears an earlier user's refresh cookie when the new sign-in gets none", async () => {
		const { app } = await authnTestAppCreate(oidcOptions);
		const { jar } = await signIn(app);
		provider.options.noRefreshToken = true;
		const { authorizeUrl, jar: secondJar } = await signInStart(app);
		const state = new URL(authorizeUrl).searchParams.get("state") ?? "";
		const code = provider.authorize(authorizeUrl, "user-2");
		const res = await app.request(
			`${appOrigin}/auth/callback?code=${code}&state=${state}&iss=${encodeURIComponent(idpOrigin)}`,
			{ headers: { Cookie: `${jar.header()}; ${secondJar.header()}` } },
		);

		expect(res.status).toBe(302);
		expect(authnSetCookieLine(res, "__Secure-authn-refresh")).toMatch(
			/Max-Age=0/,
		);
	});
});

describe("OIDC bearer tokens", () => {
	it("verifies a provider token through the remote JWKS", async () => {
		const { app } = await authnTestAppCreate(oidcOptions);
		const res = await app.request(`${appOrigin}/api/v1/me`, {
			headers: { Authorization: `Bearer ${await provider.accessToken()}` },
		});

		expect(await res.json()).toStrictEqual({
			id: "user-1",
			kind: "user",
			scopes: ["foo:read"],
		});
	});

	it.each([
		[
			"cannot be reached",
			() => {
				provider.options.down = true;
			},
		],
		[
			"answers 503",
			() => {
				provider.options.jwksFails = true;
			},
		],
	])(
		"answers 500, not 401, when the provider's JWKS %s",
		async (_, breakJwks) => {
			const { app } = await authnTestAppCreate(oidcOptions);
			const token = await provider.accessToken();
			breakJwks();
			const logError = vi
				.spyOn(logger, "error")
				.mockImplementation(() => undefined);
			const res = await app.request(`${appOrigin}/api/v1/whoami`, {
				headers: { Authorization: `Bearer ${token}` },
			});

			expect(res.status).toBe(500);
			expect(logError).toHaveBeenCalledOnce();
		},
	);
});

// Provider tokens last 10 minutes; past 9.5 the access cookie is no longer fresh, so a refresh
// goes to the provider.
const nearExpiry = () => {
	vi.useFakeTimers({ now: Date.now() + 9.5 * 60_000, toFake: ["Date"] });
};

const refreshGet = (app: Hono, jar: CookieJar, query = "") =>
	app.request(`${appOrigin}/auth/refresh${query}`, {
		headers: { Cookie: jar.header() },
	});

describe("OIDC refresh", () => {
	it("refreshes with the refresh token and stores the rotated one", async () => {
		const { app } = await authnTestAppCreate(oidcOptions);
		const { jar } = await signIn(app);
		const before = [...provider.refreshTokens];
		nearExpiry();
		const res = await refreshGet(app, jar, "?returnTo=%2Ffoos");
		jar.store(res);

		expect(res.headers.get("Location")).toBe("/foos");
		expect(provider.refreshTokens.has(before[0] ?? "")).toBe(false);
		expect(provider.refreshTokens.size).toBe(1);
		vi.useFakeTimers({ now: Date.now() + 9.5 * 60_000, toFake: ["Date"] });
		expect((await refreshGet(app, jar)).status).toBe(200);
	});

	it("answers without a grant while the access cookie has over a minute left", async () => {
		const { app } = await authnTestAppCreate(oidcOptions);
		const { jar } = await signIn(app);
		const before = [...provider.refreshTokens];
		const res = await refreshGet(app, jar);

		expect(res.status).toBe(200);
		expect(
			((await res.json()) as { expiresAt: number }).expiresAt,
		).toBeGreaterThan(Date.now() + 60_000);
		expect([...provider.refreshTokens]).toStrictEqual(before);
	});

	it("keeps the refresh token when the provider does not rotate", async () => {
		provider.options.rotate = false;
		const { app } = await authnTestAppCreate(oidcOptions);
		const { jar } = await signIn(app);
		nearExpiry();
		const first = await refreshGet(app, jar);
		jar.store(first);
		vi.useFakeTimers({ now: Date.now() + 9.5 * 60_000, toFake: ["Date"] });
		const second = await refreshGet(app, jar);

		expect(first.status).toBe(200);
		expect(authnSetCookieLine(first, "__Secure-authn-refresh")).toBeDefined();
		expect(second.status).toBe(200);
	});

	it("sends the user to sign-in when the provider refuses, leaving the cookies to another tab", async () => {
		const { app } = await authnTestAppCreate(oidcOptions);
		const { jar } = await signIn(app);
		provider.refreshTokens.clear();
		nearExpiry();
		const res = await refreshGet(app, jar, "?returnTo=%2Ffoos");

		expect(res.headers.get("Location")).toBe("/auth/sign-in?returnTo=%2Ffoos");
		expect(res.headers.getSetCookie()).toStrictEqual([]);
	});

	it("keeps the rotated refresh token when checking the new access token fails", async () => {
		const { app } = await authnTestAppCreate(oidcOptions);
		const { jar } = await signIn(app);
		// Past the JWKS cache's 10 minutes, so verifying the new token fetches the key set again.
		vi.useFakeTimers({ now: Date.now() + 11 * 60_000, toFake: ["Date"] });
		provider.options.jwksFails = true;
		vi.spyOn(logger, "error").mockImplementation(() => undefined);
		const res = await refreshGet(app, jar, "?returnTo=%2Ffoos");

		expect(res.status).toBe(500);
		expect(provider.refreshTokens.size).toBe(1);
		expect(authnSetCookieLine(res, "__Secure-authn-refresh")).toMatch(
			/Max-Age=2592000/,
		);
	});

	it.each([
		[
			"cannot be reached",
			() => {
				provider.options.down = true;
			},
		],
		[
			"answers an OAuth error with a 5xx status",
			() => {
				provider.app.fetch = async () =>
					Response.json({ error: "temporarily_unavailable" }, { status: 503 });
			},
		],
	])(
		"answers 500 rather than signing out when the provider %s",
		async (_, breakProvider) => {
			const { app } = await authnTestAppCreate(oidcOptions);
			const { jar } = await signIn(app);
			nearExpiry();
			breakProvider();
			const logError = vi
				.spyOn(logger, "error")
				.mockImplementation(() => undefined);
			const res = await refreshGet(app, jar, "?returnTo=%2Ffoos");

			expect(res.status).toBe(500);
			expect(authnSetCookieLine(res, "__Secure-authn-refresh")).toBeUndefined();
			expect(logError).toHaveBeenCalledOnce();
		},
	);
});

describe("OIDC sign-out", () => {
	it("revokes the refresh token, clears both cookies and redirects to end_session", async () => {
		const { app } = await authnTestAppCreate(oidcOptions);
		const { jar } = await signIn(app);
		const refreshToken = [...provider.refreshTokens][0];
		const res = await app.request(`${appOrigin}/auth/sign-out`, {
			headers: { Cookie: jar.header() },
			method: "POST",
		});
		const location = new URL(res.headers.get("Location") ?? "");

		expect(provider.revoked).toStrictEqual([refreshToken]);
		expect(authnSetCookieLine(res, "__Host-authn")).toMatch(/Max-Age=0/);
		expect(authnSetCookieLine(res, "__Secure-authn-refresh")).toMatch(
			/Max-Age=0/,
		);
		expect(`${location.origin}${location.pathname}`).toBe(
			`${idpOrigin}/logout`,
		);
		expect(location.searchParams.get("client_id")).toBe("app-client");
		expect(location.searchParams.get("post_logout_redirect_uri")).toBe(
			`${appOrigin}/`,
		);
	});

	it("still signs out locally when revocation fails", async () => {
		const { app } = await authnTestAppCreate(oidcOptions);
		const { jar } = await signIn(app);
		provider.options.revokeFails = true;
		vi.spyOn(logger, "warn").mockImplementation(() => undefined);
		const res = await app.request(`${appOrigin}/auth/sign-out`, {
			headers: { Cookie: jar.header() },
			method: "POST",
		});

		expect(res.status).toBe(302);
		expect(authnSetCookieLine(res, "__Host-authn")).toMatch(/Max-Age=0/);
	});
});

describe("authnCreate with a provider", () => {
	it("throws when the provider cannot be discovered, stopping startup", async () => {
		provider.options.down = true;

		await expect(authnTestAppCreate(oidcOptions)).rejects.toThrow();
	});

	it("refuses authnMemoryTokenCreate", async () => {
		const { authnMemoryTokenCreate } = await import("./index.ts");
		const { authn } = await authnTestAppCreate(oidcOptions);

		await expect(
			authnMemoryTokenCreate({
				actor: { id: "x", kind: "user", scopes: [] },
				authn,
			}),
		).rejects.toThrow("memory://");
	});
});
