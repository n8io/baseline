import { describe, expect, it } from "vitest";
import { authnTestAppCreate } from "./authn-test-app.ts";
import { authnTestOrigin } from "./authn-test-helpers.ts";
import { authnMemoryAuthorizationCreate } from "./index.ts";

// A clock the test moves; `now` is what the Authorization reads.
const clockCreate = (start = Date.now()) => {
	let time = start;
	return {
		now: () => time,
		set: (value: number) => {
			time = value;
		},
		start,
	};
};

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
	const whoami = async (authorization: string) =>
		(
			await app.request(`${authnTestOrigin}/api/v1/whoami`, {
				headers: { authorization },
			})
		).json();
	return { fetchApp, requests, whoami };
};

describe("authnMemoryAuthorizationCreate", () => {
	it("holds one token until it nears expiry, then fetches a new one", async () => {
		const clock = clockCreate();
		const start = clock.start;
		const { fetchApp, requests, whoami } = await appServe();
		const authorization = authnMemoryAuthorizationCreate({
			clientId: "feed",
			fetch: fetchApp,
			now: clock.now,
			baseUrl: authnTestOrigin,
		});

		const first = await authorization();
		clock.set(start + 13 * 60_000);
		expect(await authorization()).toBe(first);
		expect(requests).toHaveLength(1);

		// The memory issuer's tokens live 15 minutes; 60 s before that a call fetches anew.
		clock.set(start + 14 * 60_000 + 1);
		const second = await authorization();

		expect(requests).toHaveLength(2);
		expect(await whoami(second)).toStrictEqual({
			actor: { id: "feed", kind: "client", scopes: ["foo:read", "foo:update"] },
		});
	});

	it("shares one fetch between callers that ask at once", async () => {
		const { fetchApp, requests } = await appServe();
		const authorization = authnMemoryAuthorizationCreate({
			clientId: "feed",
			fetch: fetchApp,
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
		const clock = clockCreate();
		const start = clock.start;
		const calls: number[] = [];
		const authorization = authnMemoryAuthorizationCreate({
			clientId: "feed",
			fetch: async () => {
				calls.push(clock.now());
				return Response.json({
					access_token: `t${calls.length}`,
					expires_in: 10,
				});
			},
			now: clock.now,
			renewMs: 60_000,
			baseUrl: authnTestOrigin,
		});

		expect(await authorization()).toBe("Bearer t1");
		clock.set(start + 4_000);
		expect(await authorization()).toBe("Bearer t1");
		clock.set(start + 5_000);
		expect(await authorization()).toBe("Bearer t2");
	});

	it("fetches a new token on { renew: true }, as after a 401", async () => {
		const { fetchApp, requests } = await appServe();
		const authorization = authnMemoryAuthorizationCreate({
			clientId: "feed",
			fetch: fetchApp,
			baseUrl: authnTestOrigin,
		});

		await authorization();
		await authorization({ renew: true });

		expect(requests).toHaveLength(2);
	});

	it("rejects the callers of a failed fetch and tries again on the next call", async () => {
		const { fetchApp, requests } = await appServe();
		const authorization = authnMemoryAuthorizationCreate({
			clientId: "nobody",
			fetch: fetchApp,
			baseUrl: authnTestOrigin,
		});

		await expect(
			Promise.all([authorization(), authorization()]),
		).rejects.toThrow("invalid_client");
		await expect(authorization()).rejects.toThrow("invalid_client");

		expect(requests).toHaveLength(2);
	});

	it("keeps the held token while it lives when the early fetch fails", async () => {
		const clock = clockCreate();
		const start = clock.start;
		let refuse = false;
		const authorization = authnMemoryAuthorizationCreate({
			clientId: "feed",
			fetch: async () =>
				refuse
					? new Response("down", { status: 503 })
					: Response.json({ access_token: "t1", expires_in: 900 }),
			now: clock.now,
			baseUrl: authnTestOrigin,
		});

		await authorization();
		refuse = true;
		clock.set(start + 14 * 60_000 + 30_000);
		expect(await authorization()).toBe("Bearer t1");
		await expect(authorization({ renew: true })).rejects.toThrow("503");
		clock.set(start + 15 * 60_000);
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

describe("authnMemoryAuthorizationCreate details", () => {
	it("accepts a renewMs of 0", () => {
		expect(() =>
			authnMemoryAuthorizationCreate({
				baseUrl: authnTestOrigin,
				clientId: "feed",
				renewMs: 0,
			}),
		).not.toThrow();
	});

	it("asks only for the scopes it was given", async () => {
		const { fetchApp, whoami } = await appServe();
		const authorization = authnMemoryAuthorizationCreate({
			baseUrl: authnTestOrigin,
			clientId: "feed",
			fetch: fetchApp,
			scopes: ["foo:read"],
		});

		expect(
			((await whoami(await authorization())) as { actor: { scopes: string[] } })
				.actor.scopes,
		).toStrictEqual(["foo:read"]);
	});

	it("answers a call made during a fetch with that fetch's token, not the held one", async () => {
		let issued = 0;
		const authorization = authnMemoryAuthorizationCreate({
			baseUrl: authnTestOrigin,
			clientId: "feed",
			fetch: async () => {
				issued += 1;
				return Response.json({ access_token: `t${issued}`, expires_in: 900 });
			},
		});
		const held = await authorization();
		const renewing = authorization({ renew: true });
		const meanwhile = authorization();

		expect([held, await renewing, await meanwhile]).toStrictEqual([
			"Bearer t1",
			"Bearer t2",
			"Bearer t2",
		]);
	});
});
