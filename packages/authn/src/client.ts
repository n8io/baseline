import type { DataStrategyResult, MiddlewareFunction } from "react-router";

// Refresh when less than this is left, so no request carries a token about to lapse.
const refreshBeforeMs = 60_000;
const lockName = "baseline-authn-refresh";

type RouterWindow = {
	__reactRouterDataRouter?: {
		state?: { loaderData?: Record<string, unknown> };
	};
};

// The number under `key` of a runtime value, or undefined. No schema library: this file ships to
// the browser, and one number does not earn a validator in the bundle.
const numberAt = (value: unknown, key: string): number | undefined => {
	if (typeof value !== "object" || value === null) return undefined;
	const found: unknown = Reflect.get(value, key);
	return typeof found === "number" ? found : undefined;
};

let refreshedExpiresAt: number | undefined;
let inFlight: Promise<void> | undefined;

// The root loader returns `{ authnExpiresAt }`. React Router keeps the latest root data in its
// router state, so this sees it after hydration and after every revalidation.
const rootExpiresAt = (): number | undefined => {
	const root = (globalThis as RouterWindow).__reactRouterDataRouter?.state
		?.loaderData?.["root"];
	return numberAt(root, "authnExpiresAt");
};

const expiresAtKnown = (): number | undefined => {
	const fromRoot = rootExpiresAt();
	if (fromRoot === undefined) return refreshedExpiresAt;
	if (refreshedExpiresAt === undefined) return fromRoot;
	return Math.max(fromRoot, refreshedExpiresAt);
};

const refreshFetch = async (): Promise<void> => {
	// A refresh may have landed in this tab while it waited for the lock (the root loader
	// revalidated). Another tab's refresh is caught by the Server, which answers without a grant
	// while the access cookie still has over a minute left.
	const expiresAt = expiresAtKnown();
	if (expiresAt !== undefined && expiresAt - Date.now() >= refreshBeforeMs) {
		return;
	}
	const res = await fetch("/auth/refresh", {
		credentials: "same-origin",
		headers: { Accept: "application/json" },
	});
	if (!res.ok) return;
	const expiresAtBody = numberAt(await res.json(), "expiresAt");
	if (expiresAtBody !== undefined) refreshedExpiresAt = expiresAtBody;
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
 * token with `fetch` when under a minute remains, so the Server never sees it expire. A failed
 * refresh is left to the Server, which redirects to sign-in.
 */
export const authnRefreshClientMiddleware: MiddlewareFunction<
	Record<string, DataStrategyResult>
> = async (_args, next) => {
	const expiresAt = expiresAtKnown();
	if (expiresAt !== undefined && expiresAt - Date.now() < refreshBeforeMs) {
		try {
			await refreshOnce();
		} catch {
			// A network failure here must not block navigation; the Server still checks the token.
		}
	}
	return next();
};
