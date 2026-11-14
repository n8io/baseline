import {
	authnCookieKey,
	authnCookieNames,
	authnCookieOpen,
} from "./authn-cookie.ts";

export type AuthnTestSignedIn = {
	/** The access cookie's sealed value, to search telemetry for. */
	accessCookie: string;
	/** `Authorization` header value for the API. */
	authorization: string;
	/** `Cookie` header value for pages and live streams. */
	cookie: string;
	/** The access token inside the cookie, signed by the memory issuer with a key from `secret`. */
	token: string;
};

/**
 * Signs in at a served app through the memory issuer's form (`issuerUrl` `memory://`) as the
 * `memoryUsers` entry whose id is `who`. `secret` is the server's `secret`, which opens the access
 * cookie; every server with that secret accepts the token.
 */
export const authnTestSignIn = async ({
	secret,
	url,
	who,
}: {
	secret: string;
	url: string;
	who: string;
}): Promise<AuthnTestSignedIn> => {
	const res = await fetch(`${url}/auth/sign-in`, {
		body: new URLSearchParams({ who }),
		// Node's fetch sends no Origin, and a form post without one can answer 403.
		headers: { origin: url },
		method: "POST",
		redirect: "manual",
	});
	await res.body?.cancel();
	const pairs = res.headers.getSetCookie().map((line) => line.split(";")[0]);
	const prefix = `${authnCookieNames.access}=`;
	const access = pairs.find((pair) => pair?.startsWith(prefix));
	if (access === undefined) throw new Error(`sign-in failed: ${res.status}`);
	const accessCookie = access.slice(prefix.length);
	const token = await authnCookieOpen({
		key: authnCookieKey(secret),
		name: "access",
		sealed: accessCookie,
	});
	if (token === "invalid") {
		throw new Error("the access cookie did not open with this secret");
	}
	return {
		accessCookie,
		authorization: `Bearer ${token}`,
		cookie: pairs.join("; "),
		token,
	};
};
