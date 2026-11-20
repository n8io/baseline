/** What `authnMemoryTokenFetch` returns. */
export type AuthnMemoryToken = {
	/** `Authorization` header value. */
	authorization: string;
	/** When the token expires, in epoch ms. */
	expiresAt: number;
	/** The access token alone. */
	token: string;
};

/** What `authnMemoryTokenFetch` takes. */
export type AuthnMemoryTokenFetchOptions = {
	/** The served Project's origin. */
	baseUrl: string;
	/** One of the Project's `memoryClients`. */
	clientId: string;
	/** The scopes to ask for. `null` means all of the client's. */
	scopes?: string[] | null;
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
 * Fetches a machine client's access token from a served Project's memory issuer (`POST /auth/token`,
 * client credentials), for scripts and dev tools. `baseUrl` is the Project's origin. `clientId` is one of the Project's `memoryClients`;
 * `scopes` defaults to all of that client's. Rejects when the Project's issuer is not `memory://`.
 */
export const authnMemoryTokenFetch = async ({
	baseUrl,
	clientId,
	scopes,
}: AuthnMemoryTokenFetchOptions): Promise<AuthnMemoryToken> => {
	const origin = new URL(baseUrl).origin;
	const res = await fetch(`${origin}/auth/token`, {
		body: new URLSearchParams({
			client_id: clientId,
			grant_type: "client_credentials",
			...(scopes == null ? {} : { scope: scopes.join(" ") }),
		}),
		// The Project's CSRF check refuses a form post without its Origin.
		headers: { origin },
		method: "POST",
	});
	if (res.status === 404) {
		await res.body?.cancel();
		throw new Error(
			`authnMemoryTokenFetch: POST ${origin}/auth/token answered 404: the app's authn issuerUrl is not memory:// (or its auth routes are not at /auth)`,
		);
	}
	if (!res.ok) {
		throw new Error(
			`authnMemoryTokenFetch: the memory issuer at ${origin} answered ${res.status} ${await res.text()}`,
		);
	}
	const { access_token: token, expires_in } = tokenResponseRead(
		await res.json(),
	);
	return {
		authorization: `Bearer ${token}`,
		expiresAt: Date.now() + expires_in * 1000,
		token,
	};
};
