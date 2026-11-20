import {
	authnCookieKey,
	authnCookieNames,
	authnCookieOpen,
} from "./authn-cookie.ts";

/** What `authnTestSignIn` returns. */
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

/** What `authnTestSignIn` takes. */
export type AuthnTestSignInOptions = {
	/** The served Project's origin. */
	baseUrl: string;
	/** The Server's `secret`, which opens the access cookie. */
	secret: string;
	/** The id of the `memoryUsers` entry to sign in as. */
	who: string;
};

/**
 * Signs in at the served Project at `baseUrl` through the memory issuer's form (`issuerUrl` `memory://`) as the
 * `memoryUsers` entry whose id is `who`. `secret` is the Server's `secret`, which opens the access
 * cookie; every Server with that secret accepts the token.
 */
export const authnTestSignIn = async ({
	baseUrl,
	secret,
	who,
}: AuthnTestSignInOptions): Promise<AuthnTestSignedIn> => {
	const origin = new URL(baseUrl).origin;
	const res = await fetch(`${origin}/auth/sign-in`, {
		body: new URLSearchParams({ who }),
		// Node's fetch sends no Origin, and a form post without one can answer 403.
		headers: { origin },
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
