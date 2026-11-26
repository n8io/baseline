import type { Context } from "hono";
import {
	buildEndSessionUrl,
	type Configuration,
	tokenRevocation,
} from "openid-client";
import { authnCookieClear, authnCookieGet } from "./authn-cookie.ts";
import { authnLoggerDefault as logger } from "./authn-logger-default.ts";
import { authnRequestUrlPublic } from "./authn-request-url.ts";
import type { AuthnState } from "./authn-types.ts";

// Revokes the refresh token where the provider supports it; a failure still signs out locally.
const refreshTokenRevoke = async (
	config: Configuration,
	refreshToken: string,
): Promise<void> => {
	if (config.serverMetadata().revocation_endpoint === undefined) return;
	try {
		await tokenRevocation(config, refreshToken, {
			token_type_hint: "refresh_token",
		});
	} catch (error) {
		logger.warn(
			{ err: error, route: "/auth/sign-out" },
			"Refresh token not revoked; signed out locally",
		);
	}
};

export const authnRoutesSignOut = async (
	c: Context,
	authn: AuthnState,
): Promise<Response> => {
	const refreshToken = await authnCookieGet({
		c,
		key: authn.cookieKey,
		name: "refresh",
	});
	authnCookieClear(c, "access");
	authnCookieClear(c, "refresh");
	if (authn.issuer.kind === "memory") return c.redirect("/", 302);
	const { config } = authn.issuer;
	if (refreshToken !== undefined && refreshToken !== "invalid") {
		await refreshTokenRevoke(config, refreshToken);
	}
	if (config.serverMetadata().end_session_endpoint === undefined) {
		return c.redirect("/", 302);
	}
	const endSession = buildEndSessionUrl(config, {
		client_id: authn.clientId,
		post_logout_redirect_uri: authnRequestUrlPublic(c.req.raw, "/").href,
	});
	return c.redirect(endSession.href, 302);
};
