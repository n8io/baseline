export type AuthnMemoryToken = {
	/** `Authorization` header value. */
	authorization: string;
	expiresAt: Date;
	token: string;
};

const tokenResponseRead = (
	body: unknown,
): { access_token: string; expires_in: number } => {
	const { access_token, expires_in } = (body ?? {}) as Record<string, unknown>;
	if (typeof access_token !== "string" || typeof expires_in !== "number") {
		throw new TypeError(
			"authnMemoryTokenFetch: the token response has no access_token",
		);
	}
	return { access_token, expires_in };
};

/**
 * Fetches a machine client's access token from a served app's memory issuer (`POST /auth/token`,
 * client credentials), for scripts and dev tools. `clientId` is one of the app's `memoryClients`;
 * `scopes` defaults to all of that client's. Rejects when the app's issuer is not `memory://`.
 */
export const authnMemoryTokenFetch = async ({
	clientId,
	scopes,
	url,
}: {
	clientId: string;
	scopes?: string[] | null;
	url: string;
}): Promise<AuthnMemoryToken> => {
	const res = await fetch(`${url}/auth/token`, {
		body: new URLSearchParams({
			client_id: clientId,
			grant_type: "client_credentials",
			...(scopes == null ? {} : { scope: scopes.join(" ") }),
		}),
		// The app's CSRF check refuses a form post without its Origin.
		headers: { origin: new URL(url).origin },
		method: "POST",
	});
	if (res.status === 404) {
		await res.body?.cancel();
		throw new Error(
			`authnMemoryTokenFetch: POST ${url}/auth/token answered 404: the app's authn issuerUrl is not memory:// (or its auth routes are not at /auth)`,
		);
	}
	if (!res.ok) {
		throw new Error(
			`authnMemoryTokenFetch: the memory issuer at ${url} answered ${res.status} ${await res.text()}`,
		);
	}
	const { access_token: token, expires_in } = tokenResponseRead(
		await res.json(),
	);
	return {
		authorization: `Bearer ${token}`,
		expiresAt: new Date(Date.now() + expires_in * 1000),
		token,
	};
};
