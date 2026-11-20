import { afterEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => {
	vi.unstubAllGlobals();
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
		const { requests } = await appServe();

		await authnMemoryTokenFetch({
			baseUrl: `${authnTestOrigin}/`,
			clientId: "feed",
		});

		expect(requests[0]?.url).toBe(`${authnTestOrigin}/auth/token`);
		expect(requests[0]?.headers.get("origin")).toBe(authnTestOrigin);
	});

	it("names the issuer when the app is not on memory://", async () => {
		vi.stubGlobal("fetch", async () => new Response(null, { status: 404 }));

		await expect(
			authnMemoryTokenFetch({ clientId: "feed", baseUrl: authnTestOrigin }),
		).rejects.toThrow("the Project's authn issuerUrl is not memory://");
	});

	it("passes on the issuer's refusal", async () => {
		await appServe();

		await expect(
			authnMemoryTokenFetch({ clientId: "nobody", baseUrl: authnTestOrigin }),
		).rejects.toThrow('answered 401 {"error":"invalid_client"}');
	});
});
