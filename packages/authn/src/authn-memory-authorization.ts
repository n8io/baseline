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
 * callers that ask while a fetch runs share it. When that early fetch fails, callers keep the
 * held token until it expires. Takes what `authnMemoryTokenFetch` takes.
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
	const renewMs = (renewSeconds ?? 60) * 1000;
	if (!Number.isFinite(renewMs) || renewMs < 0) {
		throw new RangeError(
			`authnMemoryAuthorizationCreate: renewSeconds must be a finite number of 0 or more, got ${renewSeconds}`,
		);
	}
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
				const margin = Math.min(renewMs, lifetime / 2);
				held = { renewAt: token.expiresAt.getTime() - margin, token };
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
			if (
				fallback !== null &&
				Date.now() < fallback.token.expiresAt.getTime()
			) {
				return fallback.token.authorization;
			}
			throw error;
		}
	};
};
