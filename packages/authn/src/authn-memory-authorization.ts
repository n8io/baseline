import {
	type AuthnMemoryToken,
	authnMemoryTokenFetch,
} from "./authn-memory-token-fetch.ts";

/** Returns the current `Authorization` value; `{ renew: true }` fetches a new token first, as after a 401. */
export type AuthnMemoryAuthorization = (options?: {
	renew?: boolean | null;
}) => Promise<string>;

/**
 * Keeps a machine client's token from a served app's memory issuer fresh, for a script that runs
 * longer than a token lives. Each call returns the held `Authorization` value and fetches a new
 * token when the held one expires within `renewSeconds` (default 60, at most half its lifetime);
 * callers that ask while a fetch runs share it. Takes what `authnMemoryTokenFetch` takes.
 */
export const authnMemoryAuthorizationCreate = ({
	clientId,
	renewSeconds,
	scopes,
	url,
}: {
	clientId: string;
	renewSeconds?: number | null;
	scopes?: string[] | null;
	url: string;
}): AuthnMemoryAuthorization => {
	let held: { renewAt: number; token: AuthnMemoryToken } | null = null;
	let pending: Promise<string> | null = null;

	const tokenRenew = (): Promise<string> => {
		pending ??= (async () => {
			try {
				const fetchedAt = Date.now();
				const token = await authnMemoryTokenFetch({
					clientId,
					scopes: scopes ?? null,
					url,
				});
				const lifetime = token.expiresAt.getTime() - fetchedAt;
				const margin = Math.min((renewSeconds ?? 60) * 1000, lifetime / 2);
				held = { renewAt: token.expiresAt.getTime() - margin, token };
				return token.authorization;
			} finally {
				pending = null;
			}
		})();
		return pending;
	};

	return async (options) => {
		if (pending !== null) return pending;
		if (options?.renew !== true && held !== null && Date.now() < held.renewAt) {
			return held.token.authorization;
		}
		return tokenRenew();
	};
};
