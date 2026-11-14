import { Hono } from "hono";
import { generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authnCookieKey, authnCookieOpen } from "./authn-cookie.ts";
import { authnTestAppCreate } from "./authn-test-app.ts";
import {
	appOrigin,
	authnSetCookieLine,
	authnTestCookieJarCreate,
	authnTestPageBodyRead,
	memoryOptions,
	secret,
} from "./authn-test-helpers.ts";
import {
	type Actor,
	type AuthnMemoryUser,
	authnActorRequire,
	authnCreate,
	authnMemoryTokenCreate,
	authnMemoryTokenFetch,
	authnMiddlewareCreate,
} from "./index.ts";
import { authnTestBearerCreate, authnTestSignIn } from "./testing.ts";

const admin: Actor = {
	id: "dev-admin",
	kind: "user",
	scopes: ["foo:delete", "foo:update"],
};

type App = Awaited<ReturnType<typeof authnTestAppCreate>>["app"];

const tokenRequest = (app: App, form: Record<string, string>) =>
	app.request(`${appOrigin}/auth/token`, {
		body: new URLSearchParams(form),
		method: "POST",
	});

const whoami = async (app: App, token: string) => {
	const res = await app.request(`${appOrigin}/api/v1/whoami`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	return { body: (await res.json()) as { actor: Actor | null }, res };
};

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("the memory issuer's key", () => {
	it("is the same at every Server with the same secret, so each verifies the other's tokens", async () => {
		const first = await authnTestAppCreate();
		const second = await authnTestAppCreate();
		const token = await authnMemoryTokenCreate({
			actor: admin,
			authn: first.authn,
		});

		const { body, res } = await whoami(second.app, token);

		expect(res.status).toBe(200);
		expect(body.actor).toStrictEqual(admin);
	});

	it("refreshes at a second Server a session signed in at the first", async () => {
		vi.stubGlobal("fetch", async (input: string, init?: RequestInit) =>
			(await authnTestAppCreate()).app.request(new Request(input, init)),
		);
		const { cookie } = await authnTestSignIn({
			secret,
			url: appOrigin,
			who: "dev-admin",
		});
		const { app } = await authnTestAppCreate();
		vi.useFakeTimers({ now: Date.now() + 20 * 60_000, toFake: ["Date"] });

		const res = await app.request(`${appOrigin}/auth/refresh`, {
			headers: { Cookie: cookie },
		});

		expect(res.status).toBe(200);
		expect(authnSetCookieLine(res, "__Host-authn")).toBeDefined();
	});

	it("refreshes with the user's current scopes, and not at all once the user is gone", async () => {
		vi.stubGlobal("fetch", async (input: string, init?: RequestInit) =>
			(await authnTestAppCreate()).app.request(new Request(input, init)),
		);
		const { cookie } = await authnTestSignIn({
			secret,
			url: appOrigin,
			who: "dev-admin",
		});
		vi.useFakeTimers({ now: Date.now() + 20 * 60_000, toFake: ["Date"] });
		const refreshAt = async (memoryUsers: AuthnMemoryUser[]) => {
			const jar = authnTestCookieJarCreate();
			const { app } = await authnTestAppCreate({
				...memoryOptions,
				memoryUsers,
			});
			const res = await app.request(`${appOrigin}/auth/refresh`, {
				headers: { Cookie: cookie },
			});
			jar.store(res);
			const page = await app.request(`${appOrigin}/foos`, {
				headers: { Cookie: jar.header() },
			});
			return { page: await authnTestPageBodyRead(page), res };
		};

		const changed = await refreshAt([
			{ id: "dev-admin", name: "Dev admin", scopes: ["foo:read"] },
		]);
		const removed = await refreshAt([
			{ id: "dev-user", name: "Dev user", scopes: [] },
		]);

		expect(changed.page.actor?.scopes).toStrictEqual(["foo:read"]);
		expect(removed.res.status).toBe(401);
	});

	it("never accepts a refresh token as an access token, even with audienceClaim client_id", async () => {
		vi.stubGlobal("fetch", async (input: string, init?: RequestInit) =>
			(await authnTestAppCreate()).app.request(new Request(input, init)),
		);
		const { cookie } = await authnTestSignIn({
			secret,
			url: appOrigin,
			who: "dev-admin",
		});
		const sealed = cookie
			.split("; ")
			.find((pair) => pair.startsWith("__Secure-authn-refresh="))
			?.split("=")[1];
		const refreshToken = await authnCookieOpen({
			key: authnCookieKey(secret),
			name: "refresh",
			sealed: sealed ?? "",
		});
		const { app } = await authnTestAppCreate({
			...memoryOptions,
			audienceClaim: "client_id",
		});

		expect((await whoami(app, refreshToken)).res.status).toBe(401);
	});

	it("refuses a token signed with another algorithm as invalid, never as an outage", async () => {
		const { app } = await authnTestAppCreate();
		const { privateKey } = await generateKeyPair("ES256");
		const token = await new SignJWT({ scope: "" })
			.setProtectedHeader({ alg: "ES256" })
			.setIssuer("memory://")
			.setSubject("dev-admin")
			.setAudience("dev")
			.setExpirationTime("5m")
			.sign(privateKey);

		expect((await whoami(app, token)).res.status).toBe(401);
	});

	it("refuses an id listed twice", async () => {
		await expect(
			authnCreate({
				...memoryOptions,
				memoryUsers: [
					{ id: "dev-user", name: "One", scopes: [] },
					{ id: "dev-user", name: "Two", scopes: [] },
				],
			}),
		).rejects.toThrow('memoryUsers lists the id "dev-user" twice');
	});
});

describe("memory users", () => {
	it("lists each user with its scopes on the sign-in page, escaped", async () => {
		const { app } = await authnTestAppCreate({
			...memoryOptions,
			memoryUsers: [
				{ id: "commish", name: "Commissioner <3", scopes: ["league:manage"] },
				{ id: "player", name: "Player", scopes: [] },
			],
		});
		const html = await (await app.request(`${appOrigin}/auth/sign-in`)).text();

		expect(html).toContain('name="who" value="commish"');
		expect(html).toContain("Commissioner &lt;3");
		expect(html).toContain("league:manage");
		expect(html).toContain('name="who" value="player"');
		expect(html).toContain("no scopes");
	});

	it("offers one Dev user without scopes when memoryUsers is not set", async () => {
		const { memoryUsers, ...options } = memoryOptions;
		const { app } = await authnTestAppCreate(options);
		const html = await (await app.request(`${appOrigin}/auth/sign-in`)).text();

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
			(await whoami(app, String(body.access_token))).body.actor,
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

describe("authnMemoryTokenFetch", () => {
	const appServe = async () => {
		const served = await authnTestAppCreate();
		const requests: Request[] = [];
		vi.stubGlobal("fetch", async (input: URL, init?: RequestInit) => {
			const request = new Request(input, init);
			requests.push(request.clone());
			return served.app.request(request);
		});
		return { ...served, requests };
	};

	it("fetches a client token a served app accepts, sending the app's Origin", async () => {
		const { app, requests } = await appServe();

		const fetched = await authnMemoryTokenFetch({
			clientId: "feed",
			scopes: ["foo:read"],
			url: appOrigin,
		});

		expect(requests[0]?.headers.get("origin")).toBe(appOrigin);
		expect(fetched.authorization).toBe(`Bearer ${fetched.token}`);
		expect(fetched.expiresAt.getTime()).toBeGreaterThan(
			Date.now() + 14 * 60_000,
		);
		expect((await whoami(app, fetched.token)).body.actor).toStrictEqual({
			id: "feed",
			kind: "client",
			scopes: ["foo:read"],
		});
	});

	it("names the issuer when the app is not on memory://", async () => {
		vi.stubGlobal("fetch", async () => new Response(null, { status: 404 }));

		await expect(
			authnMemoryTokenFetch({ clientId: "feed", url: appOrigin }),
		).rejects.toThrow("the app's authn issuerUrl is not memory://");
	});

	it("passes on the issuer's refusal", async () => {
		await appServe();

		await expect(
			authnMemoryTokenFetch({ clientId: "nobody", url: appOrigin }),
		).rejects.toThrow('answered 401 {"error":"invalid_client"}');
	});
});

describe("authnTestBearerCreate", () => {
	it("gives a route test an Authn and a bearer token for any Actor", async () => {
		const { authn, tokenFor } = await authnTestBearerCreate({
			actorFromClaims: memoryOptions.actorFromClaims,
		});
		const app = new Hono()
			.use("/api/*", authnMiddlewareCreate(authn, { source: "bearer" }))
			.get("/api/me", (c) => c.json(authnActorRequire(c)));
		const res = await app.request("/api/me", {
			headers: { authorization: `Bearer ${await tokenFor(admin)}` },
		});

		expect(await res.json()).toStrictEqual(admin);
	});

	it("makes its own secret, so its tokens fit no other Authn", async () => {
		const { tokenFor } = await authnTestBearerCreate({
			actorFromClaims: memoryOptions.actorFromClaims,
		});
		const { app } = await authnTestAppCreate();

		expect((await whoami(app, await tokenFor(admin))).res.status).toBe(401);
	});
});
