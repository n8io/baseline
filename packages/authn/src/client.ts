import type { DataStrategyResult, MiddlewareFunction } from "react-router";

// Refresh when less than this is left, so no request carries a token about to lapse.
const refreshBeforeMs = 60_000;
const lockName = "baseline-authn-refresh";

type RouterWindow = {
	__reactRouterDataRouter?: {
		state?: { loaderData?: Record<string, unknown> };
	};
};

let refreshedExpiresAt: number | undefined;
let inFlight: Promise<void> | undefined;

// The root loader returns `{ authnExpiresAt }`. React Router keeps the latest root data in its
// router state, so this sees it after hydration and after every revalidation.
const rootExpiresAt = (): number | undefined => {
	const root = (globalThis as RouterWindow).__reactRouterDataRouter?.state
		?.loaderData?.root;
	if (typeof root !== "object" || root === null) return undefined;
	const { authnExpiresAt } = root as { authnExpiresAt?: unknown };
	return typeof authnExpiresAt === "number" ? authnExpiresAt : undefined;
};

const expiresAtKnown = (): number | undefined => {
	const fromRoot = rootExpiresAt();
	if (fromRoot === undefined) return refreshedExpiresAt;
	if (refreshedExpiresAt === undefined) return fromRoot;
	return Math.max(fromRoot, refreshedExpiresAt);
};

const refreshFetch = async (): Promise<void> => {
	// Another tab may have refreshed while this one waited for the lock.
	const expiresAt = expiresAtKnown();
	if (expiresAt !== undefined && expiresAt - Date.now() >= refreshBeforeMs) {
		return;
	}
	const res = await fetch("/auth/refresh", {
		credentials: "same-origin",
		headers: { Accept: "application/json" },
	});
	if (!res.ok) return;
	const body = (await res.json()) as { expiresAt?: unknown };
	if (typeof body.expiresAt === "number") refreshedExpiresAt = body.expiresAt;
};

// One refresh in flight per tab; Web Locks keep tabs from refreshing at the same time.
const refreshOnce = (): Promise<void> => {
	inFlight ??= (
		typeof navigator !== "undefined" && navigator.locks
			? navigator.locks.request(lockName, refreshFetch)
			: refreshFetch()
	).finally(() => {
		inFlight = undefined;
	});
	return inFlight;
};

/**
 * Root route `clientMiddleware`: before a navigation or form submission, refreshes the access
 * token with `fetch` when under a minute remains, so the server never sees it expire. A failed
 * refresh is left to the server, which redirects to sign-in.
 */
export const authnRefreshClientMiddleware: MiddlewareFunction<
	Record<string, DataStrategyResult>
> = async (_args, next) => {
	const expiresAt = expiresAtKnown();
	if (expiresAt !== undefined && expiresAt - Date.now() < refreshBeforeMs) {
		try {
			await refreshOnce();
		} catch {
			// A network failure here must not block navigation; the server still checks the token.
		}
	}
	return next();
};
