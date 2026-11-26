import { describe, expect, it } from "vitest";
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
