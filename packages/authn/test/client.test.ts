import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Middleware =
	typeof import("../src/client.ts").authnRefreshClientMiddleware;

const args = {} as Parameters<Middleware>[0];
const next = () => Promise.resolve({});

// Each test gets a fresh module: the in-flight refresh and learned expiry are per tab.
const middlewareLoad = async (): Promise<Middleware> => {
	vi.resetModules();
	return (await import("../src/client.ts")).authnRefreshClientMiddleware;
};

const rootExpiresAtSet = (authnExpiresAt: number | undefined) => {
	vi.stubGlobal("__reactRouterDataRouter", {
		state: { loaderData: { root: { authnExpiresAt } } },
	});
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn(async () =>
		Response.json({ expiresAt: Date.now() + 15 * 60_000 }),
	);
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("authnRefreshClientMiddleware", () => {
	it("does nothing while more than a minute remains", async () => {
		rootExpiresAtSet(Date.now() + 5 * 60_000);
		const middleware = await middlewareLoad();
		await middleware(args, next);

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("does nothing when nobody is signed in", async () => {
		rootExpiresAtSet(undefined);
		const middleware = await middlewareLoad();
		await middleware(args, next);

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("refreshes with fetch when under a minute remains, then runs the navigation", async () => {
		rootExpiresAtSet(Date.now() + 30_000);
		const middleware = await middlewareLoad();
		const order: string[] = [];
		fetchMock.mockImplementation(async () => {
			order.push("refresh");
			return Response.json({ expiresAt: Date.now() + 15 * 60_000 });
		});
		await middleware(args, async () => {
			order.push("next");
			return {};
		});

		expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/auth/refresh", {
			credentials: "same-origin",
			headers: { Accept: "application/json" },
		});
		expect(order).toStrictEqual(["refresh", "next"]);
	});

	it("keeps one refresh in flight per tab, even without Web Locks", async () => {
		rootExpiresAtSet(Date.now() + 30_000);
		vi.stubGlobal("navigator", {});
		const middleware = await middlewareLoad();
		let release = () => {};
		fetchMock.mockImplementation(
			() =>
				new Promise<Response>((resolve) => {
					release = () =>
						resolve(Response.json({ expiresAt: Date.now() + 15 * 60_000 }));
				}),
		);
		const runs = [
			middleware(args, next),
			middleware(args, next),
			middleware(args, next),
		];
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
		release();
		await Promise.all(runs);

		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("remembers the refreshed expiry, so the next navigation does not refresh again", async () => {
		rootExpiresAtSet(Date.now() + 30_000);
		const middleware = await middlewareLoad();
		await middleware(args, next);
		await middleware(args, next);

		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("takes the lock across tabs with Web Locks", async () => {
		rootExpiresAtSet(Date.now() + 30_000);
		const request = vi.fn((_name: string, run: () => Promise<void>) => run());
		vi.stubGlobal("navigator", { locks: { request } });
		const middleware = await middlewareLoad();
		await middleware(args, next);

		expect(request).toHaveBeenCalledExactlyOnceWith(
			"baseline-authn-refresh",
			expect.any(Function),
		);
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it("skips the fetch when another tab refreshed while this one waited for the lock", async () => {
		rootExpiresAtSet(Date.now() + 30_000);
		vi.stubGlobal("navigator", {
			locks: {
				request: (_name: string, run: () => Promise<void>) => {
					rootExpiresAtSet(Date.now() + 15 * 60_000);
					return run();
				},
			},
		});
		const middleware = await middlewareLoad();
		await middleware(args, next);

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("still navigates when the refresh fails", async () => {
		rootExpiresAtSet(Date.now() + 30_000);
		fetchMock.mockRejectedValue(new TypeError("offline"));
		const middleware = await middlewareLoad();
		const result = await middleware(
			args,
			async () => ({ root: { type: "data", result: 1 } }) as never,
		);

		expect(result).toStrictEqual({ root: { result: 1, type: "data" } });
	});
});
