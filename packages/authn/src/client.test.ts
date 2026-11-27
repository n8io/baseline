import { afterEach, describe, expect, it } from "vitest";
import { authnRefreshClientMiddlewareCreate } from "./client.ts";

type Middleware = ReturnType<typeof authnRefreshClientMiddlewareCreate>;

const args = {} as Parameters<Middleware>[0];
const next = () => Promise.resolve({});

type FetchCall = { init: RequestInit | undefined; input: unknown };

// A tab: the expiry the root loader returned, a recording fetch, and a middleware of its own.
const tabCreate = ({
	expiresAt,
	fetch: fetchOverride,
	lockRequest,
}: {
	expiresAt: number | undefined;
	fetch?: (() => Promise<Response>) | null;
	lockRequest?:
		| ((name: string, run: () => Promise<void>) => Promise<void>)
		| null;
}) => {
	const loader = { expiresAt };
	const calls: FetchCall[] = [];
	const middleware = authnRefreshClientMiddlewareCreate({
		fetch: async (input, init) => {
			calls.push({ init, input });
			return fetchOverride
				? fetchOverride()
				: Response.json({ expiresAt: Date.now() + 15 * 60_000 });
		},
		// Without Web Locks the middleware runs the refresh itself.
		lockRequest: lockRequest ?? null,
		loaderExpiresAt: () => loader.expiresAt,
	});
	return { calls, loader, middleware };
};

describe("authnRefreshClientMiddleware", () => {
	it("does nothing while more than a minute remains", async () => {
		const { calls, middleware } = tabCreate({
			expiresAt: Date.now() + 5 * 60_000,
		});
		await middleware(args, next);

		expect(calls).toHaveLength(0);
	});

	it("does nothing when nobody is signed in", async () => {
		const { calls, middleware } = tabCreate({ expiresAt: undefined });
		await middleware(args, next);

		expect(calls).toHaveLength(0);
	});

	it("refreshes with fetch when under a minute remains, then runs the navigation", async () => {
		const order: string[] = [];
		const { calls, middleware } = tabCreate({
			expiresAt: Date.now() + 30_000,
			fetch: async () => {
				order.push("refresh");
				return Response.json({ expiresAt: Date.now() + 15 * 60_000 });
			},
		});
		await middleware(args, async () => {
			order.push("next");
			return {};
		});

		expect(calls).toStrictEqual([
			{
				init: {
					credentials: "same-origin",
					headers: { Accept: "application/json" },
				},
				input: "/auth/refresh",
			},
		]);
		expect(order).toStrictEqual(["refresh", "next"]);
	});

	it("keeps one refresh in flight per tab, even without Web Locks", async () => {
		let release = () => {};
		let started = () => {};
		const fetchStarted = new Promise<void>((resolve) => {
			started = resolve;
		});
		const { calls, middleware } = tabCreate({
			expiresAt: Date.now() + 30_000,
			fetch: () =>
				new Promise<Response>((resolve) => {
					started();
					release = () =>
						resolve(Response.json({ expiresAt: Date.now() + 15 * 60_000 }));
				}),
		});
		const runs = [
			middleware(args, next),
			middleware(args, next),
			middleware(args, next),
		];
		await fetchStarted;
		release();
		await Promise.all(runs);

		expect(calls).toHaveLength(1);
	});

	it("remembers the refreshed expiry, so the next navigation does not refresh again", async () => {
		const { calls, middleware } = tabCreate({
			expiresAt: Date.now() + 30_000,
		});
		await middleware(args, next);
		await middleware(args, next);

		expect(calls).toHaveLength(1);
	});

	it("takes the lock across tabs with Web Locks", async () => {
		const locks: string[] = [];
		const { calls, middleware } = tabCreate({
			expiresAt: Date.now() + 30_000,
			lockRequest: (name, run) => {
				locks.push(name);
				return run();
			},
		});
		await middleware(args, next);

		expect(locks).toStrictEqual(["baseline-authn-refresh"]);
		expect(calls).toHaveLength(1);
	});

	it("skips the fetch when a refresh landed in this tab while it waited for the lock", async () => {
		const tab = tabCreate({
			expiresAt: Date.now() + 30_000,
			lockRequest: (_name, run) => {
				tab.loader.expiresAt = Date.now() + 15 * 60_000;
				return run();
			},
		});
		await tab.middleware(args, next);

		expect(tab.calls).toHaveLength(0);
	});

	it("still navigates when the refresh fails", async () => {
		const { middleware } = tabCreate({
			expiresAt: Date.now() + 30_000,
			fetch: () => Promise.reject(new TypeError("offline")),
		});
		const result = await middleware(
			args,
			async () => ({ root: { type: "data", result: 1 } }) as never,
		);

		expect(result).toStrictEqual({ root: { result: 1, type: "data" } });
	});
});

type LockRequest = (name: string, run: () => Promise<void>) => Promise<void>;

const clock = 1_000_000;
const minute = 60_000;

// A tab on a fixed clock: the expiry its root loader holds, the replies its fetch gives in turn
// (the last one repeats), and a count of fetches made.
const tabAtClockCreate = ({
	expiresAt,
	lockRequest = null,
	replies = [Response.json({ expiresAt: clock + 15 * minute })],
}: {
	expiresAt: number | undefined;
	lockRequest?: LockRequest | null;
	replies?: Response[];
}) => {
	const loader = { expiresAt };
	const state = { fetches: 0 };
	const middleware = authnRefreshClientMiddlewareCreate({
		fetch: async () => {
			const reply = replies[Math.min(state.fetches, replies.length - 1)];
			state.fetches += 1;
			return (reply as Response).clone();
		},
		loaderExpiresAt: () => loader.expiresAt,
		lockRequest,
		now: () => clock,
	});
	return { loader, middleware, state };
};

describe("refresh timing", () => {
	it("does not refresh with exactly a minute left", async () => {
		const { middleware, state } = tabAtClockCreate({
			expiresAt: clock + minute,
		});
		await middleware(args, next);

		expect(state.fetches).toBe(0);
	});

	it("refreshes with a millisecond under a minute left", async () => {
		const { middleware, state } = tabAtClockCreate({
			expiresAt: clock + minute - 1,
		});
		await middleware(args, next);

		expect(state.fetches).toBe(1);
	});

	it("skips the fetch when, after the lock wait, exactly a minute is left", async () => {
		const tab = tabAtClockCreate({
			expiresAt: clock + 30_000,
			lockRequest: (_name, run) => {
				tab.loader.expiresAt = clock + minute;
				return run();
			},
		});
		await tab.middleware(args, next);

		expect(tab.state.fetches).toBe(0);
	});

	it("fetches after the lock wait when a millisecond under a minute is left", async () => {
		const tab = tabAtClockCreate({
			expiresAt: clock + 30_000,
			lockRequest: (_name, run) => {
				tab.loader.expiresAt = clock + minute - 1;
				return run();
			},
		});
		await tab.middleware(args, next);

		expect(tab.state.fetches).toBe(1);
	});
});

describe("refresh bookkeeping", () => {
	it("starts a new refresh for each navigation once the last one settled", async () => {
		const { middleware, state } = tabAtClockCreate({
			expiresAt: clock + 30_000,
			replies: [Response.json({})],
		});
		await middleware(args, next);
		await middleware(args, next);

		expect(state.fetches).toBe(2);
	});

	it("ignores an answer that is not ok, even when it carries an expiry", async () => {
		const { middleware, state } = tabAtClockCreate({
			expiresAt: clock + 30_000,
			replies: [
				Response.json({ expiresAt: clock + 15 * minute }, { status: 401 }),
			],
		});
		await middleware(args, next);
		await middleware(args, next);

		expect(state.fetches).toBe(2);
	});

	it("ignores an expiry that is not a number", async () => {
		const { middleware, state } = tabAtClockCreate({
			expiresAt: clock + 30_000,
			replies: [Response.json({ expiresAt: "later" })],
		});
		await middleware(args, next);
		await middleware(args, next);

		expect(state.fetches).toBe(2);
	});

	it("ignores an answer that is not an object", async () => {
		const { middleware, state } = tabAtClockCreate({
			expiresAt: clock + 30_000,
			replies: [Response.json(null)],
		});
		await middleware(args, next);
		await middleware(args, next);

		expect(state.fetches).toBe(2);
	});

	it("keeps the last refreshed expiry when a later answer has none", async () => {
		const { loader, middleware, state } = tabAtClockCreate({
			expiresAt: clock + 30_000,
			replies: [
				Response.json({ expiresAt: clock + 40_000 }),
				Response.json({}),
			],
		});
		await middleware(args, next); // refreshes: expiry now known as clock + 40 s
		loader.expiresAt = clock + 30_000;
		await middleware(args, next); // refreshes again; the answer has no expiry
		loader.expiresAt = undefined;
		await middleware(args, next); // only the remembered 40 s is left to go by

		expect(state.fetches).toBe(3);
	});

	it("goes by the later of the loader's expiry and the refreshed one", async () => {
		const { loader, middleware, state } = tabAtClockCreate({
			expiresAt: clock + 30_000,
			replies: [Response.json({ expiresAt: clock + 15 * minute })],
		});
		await middleware(args, next);
		loader.expiresAt = clock + 30_000;
		await middleware(args, next);

		expect(state.fetches).toBe(1);
	});

	it("goes by the loader's expiry when nothing was refreshed yet", async () => {
		const { loader, middleware, state } = tabAtClockCreate({
			expiresAt: clock + 5 * minute,
		});
		await middleware(args, next);
		loader.expiresAt = clock + 5_000;
		await middleware(args, next);

		expect(state.fetches).toBe(1);
	});
});

describe("the root loader's expiry in React Router's state", () => {
	const routerKey = "__reactRouterDataRouter";
	const holder = globalThis as Record<string, unknown>;

	afterEach(() => {
		delete holder[routerKey];
	});

	const fetchesFor = async (router: unknown): Promise<number> => {
		if (router === undefined) delete holder[routerKey];
		else holder[routerKey] = router;
		const state = { fetches: 0 };
		const middleware = authnRefreshClientMiddlewareCreate({
			fetch: async () => {
				state.fetches += 1;
				return Response.json({ expiresAt: clock + 15 * minute });
			},
			lockRequest: null,
			now: () => clock,
		});
		await middleware(args, next);
		return state.fetches;
	};

	it("refreshes when the root loader's authnExpiresAt is nearly spent", async () => {
		const fetches = await fetchesFor({
			state: { loaderData: { root: { authnExpiresAt: clock + 30_000 } } },
		});

		expect(fetches).toBe(1);
	});

	it("does not refresh when the root loader's authnExpiresAt is far off", async () => {
		const fetches = await fetchesFor({
			state: { loaderData: { root: { authnExpiresAt: clock + 5 * minute } } },
		});

		expect(fetches).toBe(0);
	});

	it.each([
		["there is no router", undefined],
		["the router has no state", {}],
		["the state has no loader data", { state: {} }],
		["the loader data has no root", { state: { loaderData: {} } }],
		["the root data is null", { state: { loaderData: { root: null } } }],
		["the root data is a string", { state: { loaderData: { root: "x" } } }],
		[
			"the expiry is not a number",
			{ state: { loaderData: { root: { authnExpiresAt: "soon" } } } },
		],
		[
			"another key holds the expiry",
			{ state: { loaderData: { root: { expiresAt: 1 } } } },
		],
	])("does not refresh, nor throw, when %s", async (_, router) => {
		expect(await fetchesFor(router)).toBe(0);
	});
});

describe("Web Locks from the browser", () => {
	const navigatorDescriptor = Object.getOwnPropertyDescriptor(
		globalThis,
		"navigator",
	);

	afterEach(() => {
		if (navigatorDescriptor === undefined)
			Reflect.deleteProperty(globalThis, "navigator");
		else Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
	});

	const navigatorSet = (value: unknown) => {
		Object.defineProperty(globalThis, "navigator", {
			configurable: true,
			value,
			writable: true,
		});
	};

	const refreshRun = async () => {
		const state = { fetches: 0 };
		const middleware = authnRefreshClientMiddlewareCreate({
			fetch: async () => {
				state.fetches += 1;
				return Response.json({ expiresAt: clock + 15 * minute });
			},
			loaderExpiresAt: () => clock + 30_000,
			now: () => clock,
		});
		await middleware(args, next);
		return state.fetches;
	};

	it("takes navigator.locks when the browser has them", async () => {
		const names: string[] = [];
		navigatorSet({
			locks: {
				request: async (name: string, run: () => Promise<void>) => {
					names.push(name);
					await run();
				},
			},
		});

		expect(await refreshRun()).toBe(1);
		expect(names).toStrictEqual(["baseline-authn-refresh"]);
	});

	it("refreshes without a lock when the browser has no locks", async () => {
		navigatorSet({});

		expect(await refreshRun()).toBe(1);
	});

	it("refreshes without a lock when there is no navigator", async () => {
		navigatorSet(undefined);

		expect(await refreshRun()).toBe(1);
	});
});
