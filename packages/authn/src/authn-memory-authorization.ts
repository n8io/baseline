import {
	type AuthnMemoryToken,
	authnMemoryTokenFetch,
} from "./authn-memory-token-fetch.ts";

/** What `authnMemoryAuthorizationCreate` takes. */
export type AuthnMemoryAuthorizationOptions = {
	/** The served Project's origin. */
	baseUrl: string;
	/** One of the Project's `memoryClients`. */
	clientId: string;
	/** How long before expiry a new token is fetched, in ms; at most half the token's lifetime. `null` means 60,000. */
	renewMs?: number | null;
	/** The scopes to ask for. `null` means all of the client's. */
	scopes?: string[] | null;
};

/** Returns the current `Authorization` value; `{ renew: true }` fetches a new token first, as after a 401. */
export type AuthnMemoryAuthorization = (options?: {
	renew?: boolean | null;
}) => Promise<string>;

/**
 * Keeps a machine client's token from a served Project's memory issuer fresh, for a script that runs
 * longer than a token lives. Each call returns the held `Authorization` value and fetches a new
 * token when the held one expires within `renewMs` (default 60,000, at most half its lifetime);
 * callers that ask while a fetch runs share it. When that early fetch fails, callers keep the
 * held token until it expires. Takes `AuthnMemoryAuthorizationOptions`.
 */
export const authnMemoryAuthorizationCreate = ({
	baseUrl,
	clientId,
	renewMs: renewMsOption,
	scopes,
}: AuthnMemoryAuthorizationOptions): AuthnMemoryAuthorization => {
	const renewMs = renewMsOption ?? 60_000;
	if (!Number.isFinite(renewMs) || renewMs < 0) {
		throw new TypeError(
			`authnMemoryAuthorizationCreate: renewMs must be a finite number of 0 or more, got ${renewMsOption}`,
		);
	}
	let held: { renewAt: number; token: AuthnMemoryToken } | null = null;
	let pending: Promise<string> | null = null;

	const tokenRenew = (): Promise<string> => {
		pending ??= (async () => {
			try {
				const fetchedAt = Date.now();
				const token = await authnMemoryTokenFetch({
					baseUrl,
					clientId,
					scopes: scopes ?? null,
				});
				const lifetime = token.expiresAt - fetchedAt;
				const margin = Math.min(renewMs, lifetime / 2);
				held = { renewAt: token.expiresAt - margin, token };
				return token.authorization;
			} finally {
				pending = null;
			}
		})();
		return pending;
	};

	return async (options) => {
		const renew = options?.renew === true;
		if (
			pending === null &&
			!renew &&
			held !== null &&
			Date.now() < held.renewAt
		) {
			return held.token.authorization;
		}
		const fallback = renew ? null : held;
		try {
			return await tokenRenew();
		} catch (error) {
			if (fallback !== null && Date.now() < fallback.token.expiresAt) {
				return fallback.token.authorization;
			}
			throw error;
		}
	};
};
