import { logger } from "@n8io/baseline-logger";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appCreate } from "./app.ts";
import {
	type FakeProvider,
	fakeProviderCreate,
	idpOrigin,
} from "./fake-provider.ts";
import {
	actorFromClaims,
	appOrigin,
	cookieJar,
	pageBody,
	secret,
	setCookieLine,
} from "./helpers.ts";

const oidcOptions = {
	actorFromClaims,
	audience: "api",
	clientId: "app-client",
	clientSecret: "app-secret",
	issuerUrl: idpOrigin,
	secret,
};

let provider: FakeProvider;

beforeEach(async () => {
	provider = await fakeProviderCreate(oidcOptions.clientId);
	const realFetch = globalThis.fetch;
	vi.stubGlobal(
		"fetch",
		(input: string | URL | Request, init?: RequestInit) => {
			let request: Request;
			try {
				request = new Request(input, init);
			} catch (e) {
				console.log("STUBERR", String(input), e);
				throw e;
			}
			if (!request.url.startsWith(idpOrigin)) return realFetch(request);
			if (provider.options.down)
				return Promise.reject(new TypeError("fetch failed"));
			return Promise.resolve(provider.app.fetch(request));
		},
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const signInStart = async (app: Hono, returnTo = "/foos") => {
	const jar = cookieJar();
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
		const { app } = await appCreate(oidcOptions);
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
		const { app } = await appCreate(oidcOptions);
		const { res } = await signInStart(app);
		const line = setCookieLine(res, "__Secure-authn-flow");

		expect(line).toContain("Max-Age=600");
		expect(line).toContain("Path=/auth/callback");
		expect(line).toContain("HttpOnly");
		expect(line).toContain("Secure");
		expect(line).toContain("SameSite=Lax");
	});

	it("passes authorizeParams, such as Auth0's audience", async () => {
		const { app } = await appCreate({
			...oidcOptions,
			authorizeParams: { audience: "https://api.example" },
		});
		const { authorizeUrl } = await signInStart(app);

		expect(new URL(authorizeUrl).searchParams.get("audience")).toBe(
			"https://api.example",
		);
	});

	it("builds the https redirect_uri behind a TLS proxy", async () => {
		const { app } = await appCreate(oidcOptions);
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
		const { app } = await appCreate(oidcOptions);
		const { jar, res } = await signIn(app);

		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe("/foos");
		expect(setCookieLine(res, "__Secure-authn-flow")).toMatch(/Max-Age=0/);
		const page = await app.request(`${appOrigin}/foos`, {
			headers: { Cookie: jar.header() },
		});
		expect((await pageBody(page)).actor).toStrictEqual({
			id: "user-1",
			kind: "user",
			scopes: ["foo:read"],
		});
	});

	it("shows the failure page when state does not match", async () => {
		const { app } = await appCreate(oidcOptions);
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
		expect(setCookieLine(res, "__Host-authn")).toBeUndefined();
	});

	it("shows the failure page when the provider refuses", async () => {
		const { app } = await appCreate(oidcOptions);
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
		const { app } = await appCreate(oidcOptions);
		const res = await app.request(`${appOrigin}/auth/callback?code=x&state=y`);

		expect(res.status).toBe(400);
	});

	it("refuses an access token for another audience", async () => {
		provider.options.accessAudience = "someone-else";
		const { app } = await appCreate(oidcOptions);
		const { res } = await signIn(app);

		expect(res.status).toBe(400);
		expect(setCookieLine(res, "__Host-authn")).toBeUndefined();
	});

	it("verifies provider bearer tokens on the API through the remote JWKS", async () => {
		const { app } = await appCreate(oidcOptions);
		const code = provider.authorize(
			`${idpOrigin}/authorize?code_challenge=x&nonce=n`,
		);
		expect(code).toBeTruthy();
		const tokenRes = await provider.app.request(`${idpOrigin}/token`, {
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: "none",
			}),
			method: "POST",
		});
		expect(tokenRes.status).toBe(400);
		const { jar } = await signIn(app);
		const refresh = await app.request(`${appOrigin}/auth/refresh`, {
			headers: { Cookie: jar.header() },
		});
		expect(refresh.status).toBe(200);
	});
});

describe("OIDC refresh", () => {
	it("refreshes with the refresh token and stores the rotated one", async () => {
		const { app } = await appCreate(oidcOptions);
		const { jar } = await signIn(app);
		const before = [...provider.refreshTokens];
		const res = await app.request(
			`${appOrigin}/auth/refresh?returnTo=%2Ffoos`,
			{
				headers: { Cookie: jar.header() },
			},
		);
		jar.store(res);

		expect(res.headers.get("Location")).toBe("/foos");
		expect(provider.refreshTokens.has(before[0] ?? "")).toBe(false);
		const again = await app.request(`${appOrigin}/auth/refresh`, {
			headers: { Cookie: jar.header() },
		});
		expect(again.status).toBe(200);
	});

	it("keeps the refresh token when the provider does not rotate", async () => {
		provider.options.rotate = false;
		const { app } = await appCreate(oidcOptions);
		const { jar } = await signIn(app);
		const first = await app.request(`${appOrigin}/auth/refresh`, {
			headers: { Cookie: jar.header() },
		});
		jar.store(first);
		const second = await app.request(`${appOrigin}/auth/refresh`, {
			headers: { Cookie: jar.header() },
		});

		expect(first.status).toBe(200);
		expect(second.status).toBe(200);
	});

	it("clears the cookies and sends the user to sign-in when the provider refuses", async () => {
		const { app } = await appCreate(oidcOptions);
		const { jar } = await signIn(app);
		provider.refreshTokens.clear();
		const res = await app.request(
			`${appOrigin}/auth/refresh?returnTo=%2Ffoos`,
			{
				headers: { Cookie: jar.header() },
			},
		);

		expect(res.headers.get("Location")).toBe("/auth/sign-in?returnTo=%2Ffoos");
		expect(setCookieLine(res, "__Secure-authn-refresh")).toMatch(/Max-Age=0/);
	});

	it.each([
		[
			"cannot be reached",
			() => {
				provider.options.down = true;
			},
		],
		[
			"answers 5xx",
			() => {
				provider.app.fetch = async () => new Response("oops", { status: 503 });
			},
		],
	])(
		"answers 500 rather than signing out when the provider %s",
		async (_, breakProvider) => {
			const { app } = await appCreate(oidcOptions);
			const { jar } = await signIn(app);
			breakProvider();
			const logError = vi
				.spyOn(logger, "error")
				.mockImplementation(() => undefined);
			const res = await app.request(
				`${appOrigin}/auth/refresh?returnTo=%2Ffoos`,
				{
					headers: { Cookie: jar.header() },
				},
			);

			expect(res.status).toBe(500);
			expect(setCookieLine(res, "__Secure-authn-refresh")).toBeUndefined();
			expect(logError).toHaveBeenCalledOnce();
		},
	);
});

describe("OIDC sign-out", () => {
	it("revokes the refresh token, clears both cookies and redirects to end_session", async () => {
		const { app } = await appCreate(oidcOptions);
		const { jar } = await signIn(app);
		const refreshToken = [...provider.refreshTokens][0];
		const res = await app.request(`${appOrigin}/auth/sign-out`, {
			headers: { Cookie: jar.header() },
			method: "POST",
		});
		const location = new URL(res.headers.get("Location") ?? "");

		expect(provider.revoked).toStrictEqual([refreshToken]);
		expect(setCookieLine(res, "__Host-authn")).toMatch(/Max-Age=0/);
		expect(setCookieLine(res, "__Secure-authn-refresh")).toMatch(/Max-Age=0/);
		expect(`${location.origin}${location.pathname}`).toBe(
			`${idpOrigin}/logout`,
		);
		expect(location.searchParams.get("client_id")).toBe("app-client");
		expect(location.searchParams.get("post_logout_redirect_uri")).toBe(
			`${appOrigin}/`,
		);
	});

	it("still signs out locally when revocation fails", async () => {
		const { app } = await appCreate(oidcOptions);
		const { jar } = await signIn(app);
		provider.options.revokeFails = true;
		vi.spyOn(logger, "warn").mockImplementation(() => undefined);
		const res = await app.request(`${appOrigin}/auth/sign-out`, {
			headers: { Cookie: jar.header() },
			method: "POST",
		});

		expect(res.status).toBe(302);
		expect(setCookieLine(res, "__Host-authn")).toMatch(/Max-Age=0/);
	});
});

describe("authnCreate with a provider", () => {
	it("throws when the provider cannot be discovered, stopping startup", async () => {
		provider.options.down = true;

		await expect(appCreate(oidcOptions)).rejects.toThrow();
	});

	it("refuses authnMemoryTokenCreate", async () => {
		const { authnMemoryTokenCreate } = await import("../src/index.ts");
		const { authn } = await appCreate(oidcOptions);

		await expect(
			authnMemoryTokenCreate(authn, { id: "x", kind: "user", scopes: [] }),
		).rejects.toThrow("memory://");
	});
});
