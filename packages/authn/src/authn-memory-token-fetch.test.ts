import { describe, expect, it } from "vitest";
import { authnMemoryTokenFetch } from "./authn-memory-token-fetch.ts";
import { authnTestAppCreate } from "./authn-test-app.ts";
import { authnTestOrigin } from "./authn-test-helpers.ts";
import type { Actor } from "./index.ts";

type App = Awaited<ReturnType<typeof authnTestAppCreate>>["app"];

const whoami = async (app: App, token: string) => {
	const res = await app.request(`${authnTestOrigin}/api/v1/whoami`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	return { body: (await res.json()) as { actor: Actor | null }, res };
};

describe("authnMemoryTokenFetch", () => {
	const appServe = async () => {
		const served = await authnTestAppCreate();
		const requests: Request[] = [];
		const fetchApp = async (
			input: string | URL | Request,
			init?: RequestInit,
		) => {
			const request = new Request(input, init);
			requests.push(request.clone());
			return served.app.request(request);
		};
		return { ...served, fetchApp, requests };
	};

	it("fetches a client token a served app accepts, sending the app's Origin", async () => {
		const { app, fetchApp, requests } = await appServe();

		const fetched = await authnMemoryTokenFetch({
			clientId: "feed",
			fetch: fetchApp,
			scopes: ["foo:read"],
			baseUrl: authnTestOrigin,
		});

		expect(requests[0]?.headers.get("origin")).toBe(authnTestOrigin);
		expect(fetched.authorization).toBe(`Bearer ${fetched.token}`);
		expect(fetched.expiresAt).toBeGreaterThan(Date.now() + 14 * 60_000);
		expect((await whoami(app, fetched.token)).body.actor).toStrictEqual({
			id: "feed",
			kind: "client",
			scopes: ["foo:read"],
		});
	});

	it("takes the origin of a baseUrl with a trailing slash", async () => {
		const { fetchApp, requests } = await appServe();

		await authnMemoryTokenFetch({
			baseUrl: `${authnTestOrigin}/`,
			clientId: "feed",
			fetch: fetchApp,
		});

		expect(requests[0]?.url).toBe(`${authnTestOrigin}/auth/token`);
		expect(requests[0]?.headers.get("origin")).toBe(authnTestOrigin);
	});

	it("names the issuer when the app is not on memory://", async () => {
		await expect(
			authnMemoryTokenFetch({
				clientId: "feed",
				fetch: async () => new Response(null, { status: 404 }),
				baseUrl: authnTestOrigin,
			}),
		).rejects.toThrow("the Project's authn issuerUrl is not memory://");
	});

	it("passes on the issuer's refusal", async () => {
		const { fetchApp } = await appServe();

		await expect(
			authnMemoryTokenFetch({
				clientId: "nobody",
				fetch: fetchApp,
				baseUrl: authnTestOrigin,
			}),
		).rejects.toThrow('answered 401 {"error":"invalid_client"}');
	});
});
