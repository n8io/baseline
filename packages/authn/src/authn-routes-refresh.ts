import type { Context } from "hono";
import { ResponseBodyError, refreshTokenGrant } from "openid-client";
import { authnCookieGet } from "./authn-cookie.ts";
import { authnReturnToSafe } from "./authn-return-to.ts";
import {
	authnRoutesAccessFreshFor,
	authnRoutesTokensStore,
} from "./authn-routes-tokens.ts";
import type { AuthnState, AuthnTokens } from "./authn-types.ts";

const refreshSkipMs = 60_000;

const tokensRefresh = async (
	authn: AuthnState,
	refreshToken: string,
): Promise<AuthnTokens | undefined> => {
	if (authn.issuer.kind === "memory") {
		return authn.issuer.tokensRefresh(refreshToken);
	}
	try {
		const tokens = await refreshTokenGrant(authn.issuer.config, refreshToken);
		return {
			accessToken: tokens.access_token,
			// Providers that do not rotate refresh tokens send none back; keep the one we have.
			refreshToken: tokens.refresh_token ?? refreshToken,
		};
	} catch (error) {
		// Only the provider saying no (an OAuth error body such as `invalid_grant`) signs the user
		// out. openid-client reports a 5xx as a ClientError and an outage as a TypeError; both throw,
		// so a provider hiccup never signs everyone out.
		if (error instanceof ResponseBodyError) return undefined;
		throw error;
	}
};

const refreshRun = async (
	c: Context,
	authn: AuthnState,
): Promise<number | undefined> => {
	const fresh = await authnRoutesAccessFreshFor({
		c,
		authn,
		minimumMs: refreshSkipMs,
	});
	if (fresh !== undefined) return fresh;
	const refreshToken = await authnCookieGet({
		c,
		key: authn.cookieKey,
		name: "refresh",
	});
	if (refreshToken === undefined || refreshToken === "invalid")
		return undefined;
	const tokens = await tokensRefresh(authn, refreshToken);
	return tokens === undefined
		? undefined
		: authnRoutesTokensStore({ c, authn, tokens });
};

/**
 * `GET /auth/refresh?returnTo=…` (a page whose token is expiring) refreshes both cookies and
 * redirects back, or to sign-in when the refresh fails. Without `returnTo` (the client
 * middleware's `fetch`) it answers `{ expiresAt }`, or 401. A failed refresh leaves the cookies
 * alone: with refresh token rotation, two tabs refreshing at once see one fail, and clearing
 * would undo the other's fresh cookies. A new sign-in replaces them.
 */
export const authnRoutesRefresh = async (
	c: Context,
	authn: AuthnState,
): Promise<Response> => {
	const returnTo = c.req.query("returnTo");
	const expiresAt = await refreshRun(c, authn);
	if (returnTo === undefined) {
		return expiresAt === undefined
			? c.body(null, 401)
			: c.json({ expiresAt }, 200, { "Cache-Control": "no-store" });
	}
	const safeReturnTo = authnReturnToSafe(returnTo);
	return expiresAt === undefined
		? c.redirect(
				`/auth/sign-in?returnTo=${encodeURIComponent(safeReturnTo)}`,
				302,
			)
		: c.redirect(safeReturnTo, 302);
};
