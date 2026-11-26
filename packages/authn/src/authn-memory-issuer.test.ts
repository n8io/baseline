import { generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { authnCookieKey, authnCookieOpen } from "./authn-cookie.ts";
import { authnTestAppCreate } from "./authn-test-app.ts";
import { authnTestCookieForge } from "./authn-test-forge.ts";
import {
	authnTestCookieJarCreate,
	authnTestMemoryOptions,
	authnTestOrigin,
	authnTestPageBodyRead,
	authnTestSecret,
	authnTestSetCookieLine,
} from "./authn-test-helpers.ts";
import { type Actor, type AuthnMemoryUser, authnCreate } from "./index.ts";
import { authnTestSignIn, authnTestTokenCreate } from "./testing.ts";

const admin: Actor = {
	id: "dev-admin",
	kind: "user",
	scopes: ["foo:delete", "foo:update"],
};

const whoami = async (
	app: Awaited<ReturnType<typeof authnTestAppCreate>>["app"],
	token: string,
) => {
	const res = await app.request(`${authnTestOrigin}/api/v1/whoami`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	return { body: (await res.json()) as { actor: Actor | null }, res };
};

// A Server's fetch: every sign-in goes to a fresh app with the same secret.
const fetchApp = async (input: string | URL | Request, init?: RequestInit) =>
	(await authnTestAppCreate()).app.request(new Request(input, init));

describe("the memory issuer's key", () => {
	it("is the same at every Server with the same secret, so each verifies the other's tokens", async () => {
		const first = await authnTestAppCreate();
		const second = await authnTestAppCreate();
		const token = await authnTestTokenCreate({
			actor: admin,
			authn: first.authn,
		});

		const { body, res } = await whoami(second.app, token);

		expect(res.status).toBe(200);
		expect(body.actor).toStrictEqual(admin);
	});

	it("refreshes at a second Server a session signed in at the first", async () => {
		const { cookie } = await authnTestSignIn({
			fetch: fetchApp,
			secret: authnTestSecret,
			baseUrl: authnTestOrigin,
			who: "dev-admin",
		});
		const { app } = await authnTestAppCreate();
		// 20 minutes on, the access token has lapsed; the refresh cookie still holds.
		const lapsed = await authnTestCookieForge({
			actor: admin,
			expiresInSeconds: -5 * 60,
			keep: cookie,
		});

		const res = await app.request(`${authnTestOrigin}/auth/refresh`, {
			headers: { Cookie: lapsed },
		});

		expect(res.status).toBe(200);
		expect(authnTestSetCookieLine(res, "__Host-authn")).toBeDefined();
	});

	it("refreshes with the user's current scopes, and not at all once the user is gone", async () => {
		const { cookie } = await authnTestSignIn({
			fetch: fetchApp,
			secret: authnTestSecret,
			baseUrl: authnTestOrigin,
			who: "dev-admin",
		});
		const lapsed = await authnTestCookieForge({
			actor: admin,
			expiresInSeconds: -5 * 60,
			keep: cookie,
		});
		const refreshAt = async (memoryUsers: AuthnMemoryUser[]) => {
			const jar = authnTestCookieJarCreate();
			const { app } = await authnTestAppCreate({
				...authnTestMemoryOptions,
				memoryUsers,
			});
			const res = await app.request(`${authnTestOrigin}/auth/refresh`, {
				headers: { Cookie: lapsed },
			});
			jar.store(res);
			const page = await app.request(`${authnTestOrigin}/foos`, {
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
		const { cookie } = await authnTestSignIn({
			fetch: fetchApp,
			secret: authnTestSecret,
			baseUrl: authnTestOrigin,
			who: "dev-admin",
		});
		const sealed = cookie
			.split("; ")
			.find((pair) => pair.startsWith("__Secure-authn-refresh="))
			?.split("=")[1];
		const refreshToken = await authnCookieOpen({
			key: authnCookieKey(authnTestSecret),
			name: "refresh",
			sealed: sealed ?? "",
		});
		const { app } = await authnTestAppCreate({
			...authnTestMemoryOptions,
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
				...authnTestMemoryOptions,
				memoryUsers: [
					{ id: "dev-user", name: "One", scopes: [] },
					{ id: "dev-user", name: "Two", scopes: [] },
				],
			}),
		).rejects.toThrow('memoryUsers lists the id "dev-user" twice');
	});
});
