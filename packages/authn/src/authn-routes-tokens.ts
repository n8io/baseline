import type { Context } from "hono";
import { decodeJwt } from "jose";
import {
	authnCookieClear,
	authnCookieGet,
	authnCookieSet,
} from "./authn-cookie.ts";
import type { AuthnState, AuthnTokens } from "./authn-types.ts";

/**
 * Writes the refresh cookie, then verifies the access token and writes the access cookie;
 * returns its expiry, or `undefined` when it does not verify. The refresh cookie goes first: the
 * provider may already have rotated it, so it must survive a verify that throws (an outage).
 * No refresh token clears the old one, so a new sign-in never inherits another's.
 */
export const authnRoutesTokensStore = async ({
	authn,
	c,
	tokens,
}: {
	authn: AuthnState;
	c: Context;
	tokens: AuthnTokens;
}): Promise<number | undefined> => {
	if (tokens.refreshToken === undefined) authnCookieClear(c, "refresh");
	else
		await authnCookieSet({
			c,
			key: authn.cookieKey,
			name: "refresh",
			value: tokens.refreshToken,
		});
	const verified = await authn.verify(tokens.accessToken);
	if (verified.status !== "valid") return undefined;
	await authnCookieSet({
		c,
		key: authn.cookieKey,
		name: "access",
		value: tokens.accessToken,
	});
	return verified.expiresAt;
};

// Another tab may have refreshed already; its cookie is then fresh and needs no grant.
export const authnRoutesAccessFreshFor = async ({
	authn,
	c,
	minimumMs,
}: {
	authn: AuthnState;
	c: Context;
	minimumMs: number;
}): Promise<number | undefined> => {
	const accessToken = await authnCookieGet({
		c,
		key: authn.cookieKey,
		name: "access",
	});
	if (accessToken === undefined || accessToken === "invalid") return undefined;
	// Read `exp` before verifying, so an expiring token costs no JWKS lookup.
	let exp: number | undefined;
	try {
		({ exp } = decodeJwt(accessToken));
	} catch {
		return undefined;
	}
	if (exp === undefined || exp * 1000 - Date.now() < minimumMs)
		return undefined;
	const verified = await authn.verify(accessToken);
	return verified.status === "valid" &&
		verified.expiresAt - Date.now() >= minimumMs
		? verified.expiresAt
		: undefined;
};
