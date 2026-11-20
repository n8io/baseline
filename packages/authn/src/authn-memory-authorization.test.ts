import { afterEach, describe, expect, it, vi } from "vitest";
import { authnTestAppCreate } from "./authn-test-app.ts";
import { authnTestOrigin } from "./authn-test-helpers.ts";
import { authnMemoryAuthorizationCreate } from "./index.ts";

const appServe = async () => {
	const { app } = await authnTestAppCreate();
	const requests: Request[] = [];
	vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
		const request = new Request(input, init);
		requests.push(request);
		return app.request(request);
	});
	const whoami = async (authorization: string) =>
		(
			await app.request(`${authnTestOrigin}/api/v1/whoami`, {
				headers: { authorization },
			})
		).json();
	return { requests, whoami };
};

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("authnMemoryAuthorizationCreate", () => {
	it("holds one token until it nears expiry, then fetches a new one", async () => {
		const start = Date.now();
		vi.useFakeTimers({ now: start, toFake: ["Date"] });
		const { requests, whoami } = await appServe();
		const authorization = authnMemoryAuthorizationCreate({
			clientId: "feed",
			baseUrl: authnTestOrigin,
		});

		const first = await authorization();
		vi.setSystemTime(start + 13 * 60_000);
		expect(await authorization()).toBe(first);
		expect(requests).toHaveLength(1);

		// The memory issuer's tokens live 15 minutes; 60 s before that a call fetches anew.
		vi.setSystemTime(start + 14 * 60_000 + 1);
		const second = await authorization();

		expect(requests).toHaveLength(2);
		expect(second).not.toBe(first);
		expect(await whoami(second)).toStrictEqual({
			actor: { id: "feed", kind: "client", scopes: ["foo:read", "foo:update"] },
		});
	});

	it("shares one fetch between callers that ask at once", async () => {
		const { requests } = await appServe();
		const authorization = authnMemoryAuthorizationCreate({
			clientId: "feed",
			baseUrl: authnTestOrigin,
		});

		const values = await Promise.all([
			authorization(),
			authorization(),
			authorization(),
		]);

		expect(requests).toHaveLength(1);
		expect(new Set(values).size).toBe(1);
	});

	it("renews at half a short token's lifetime when renewMs would refetch every call", async () => {
		const start = Date.now();
		vi.useFakeTimers({ now: start, toFake: ["Date"] });
		const calls: number[] = [];
		vi.stubGlobal("fetch", async () => {
			calls.push(Date.now());
			return Response.json({
				access_token: `t${calls.length}`,
				expires_in: 10,
			});
		});
		const authorization = authnMemoryAuthorizationCreate({
			clientId: "feed",
			renewMs: 60_000,
			baseUrl: authnTestOrigin,
		});

		expect(await authorization()).toBe("Bearer t1");
		vi.setSystemTime(start + 4_000);
		expect(await authorization()).toBe("Bearer t1");
		vi.setSystemTime(start + 5_000);
		expect(await authorization()).toBe("Bearer t2");
	});

	it("fetches a new token on { renew: true }, as after a 401", async () => {
		const { requests } = await appServe();
		const authorization = authnMemoryAuthorizationCreate({
			clientId: "feed",
			baseUrl: authnTestOrigin,
		});

		await authorization();
		await authorization({ renew: true });

		expect(requests).toHaveLength(2);
	});

	it("rejects the callers of a failed fetch and tries again on the next call", async () => {
		const { requests } = await appServe();
		const authorization = authnMemoryAuthorizationCreate({
			clientId: "nobody",
			baseUrl: authnTestOrigin,
		});

		await expect(
			Promise.all([authorization(), authorization()]),
		).rejects.toThrow("invalid_client");
		await expect(authorization()).rejects.toThrow("invalid_client");

		expect(requests).toHaveLength(2);
	});

	it("keeps the held token while it lives when the early fetch fails", async () => {
		const start = Date.now();
		vi.useFakeTimers({ now: start, toFake: ["Date"] });
		let refuse = false;
		vi.stubGlobal("fetch", async () =>
			refuse
				? new Response("down", { status: 503 })
				: Response.json({ access_token: "t1", expires_in: 900 }),
		);
		const authorization = authnMemoryAuthorizationCreate({
			clientId: "feed",
			baseUrl: authnTestOrigin,
		});

		await authorization();
		refuse = true;
		vi.setSystemTime(start + 14 * 60_000 + 30_000);
		expect(await authorization()).toBe("Bearer t1");
		await expect(authorization({ renew: true })).rejects.toThrow("503");
		vi.setSystemTime(start + 15 * 60_000);
		await expect(authorization()).rejects.toThrow("503");
	});

	it("refuses a renewMs that is negative or not a number", () => {
		for (const renewMs of [-1, Number.NaN]) {
			expect(() =>
				authnMemoryAuthorizationCreate({
					clientId: "feed",
					renewMs,
					baseUrl: authnTestOrigin,
				}),
			).toThrow(
				new TypeError(
					`authnMemoryAuthorizationCreate: renewMs must be a finite number of 0 or more, found ${renewMs}`,
				),
			);
		}
	});
});
