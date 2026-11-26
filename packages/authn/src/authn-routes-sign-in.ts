import type { Context } from "hono";
import {
	AuthorizationResponseError,
	authorizationCodeGrant,
	buildAuthorizationUrl,
	ClientError,
	type Configuration,
	calculatePKCECodeChallenge,
	ResponseBodyError,
	randomNonce,
	randomPKCECodeVerifier,
	randomState,
	WWWAuthenticateChallengeError,
} from "openid-client";
import { z } from "zod";
import {
	authnCookieClear,
	authnCookieGet,
	authnCookieSet,
} from "./authn-cookie.ts";
import { authnLoggerDefault as logger } from "./authn-logger-default.ts";
import { authnRequestUrlPublic } from "./authn-request-url.ts";
import { authnRoutesTokensStore } from "./authn-routes-tokens.ts";
import { authnSignInPageFailed } from "./authn-sign-in-page.ts";
import type { AuthnOidcIssuer, AuthnState } from "./authn-types.ts";

const FlowState = z.object({
	codeVerifier: z.string(),
	nonce: z.string(),
	returnTo: z.string(),
	state: z.string(),
});

const callbackPath = "/auth/callback";

// What the provider can refuse: an error in the callback or token response, or a check
// (state, nonce, PKCE, id token) that fails. Network failures are not in this list; they throw.
const authnProviderRefusalIs = (error: unknown): boolean =>
	error instanceof AuthorizationResponseError ||
	error instanceof ResponseBodyError ||
	error instanceof WWWAuthenticateChallengeError ||
	error instanceof ClientError;

export const authnRoutesSignInStart = async ({
	authn,
	c,
	issuer,
	returnTo,
}: {
	authn: AuthnState;
	c: Context;
	issuer: AuthnOidcIssuer;
	returnTo: string;
}): Promise<Response> => {
	const codeVerifier = randomPKCECodeVerifier();
	const nonce = randomNonce();
	const state = randomState();
	await authnCookieSet({
		c,
		key: authn.cookieKey,
		name: "flow",
		value: JSON.stringify({ codeVerifier, nonce, returnTo, state }),
	});
	const url = buildAuthorizationUrl(issuer.config, {
		scope: "openid offline_access",
		...issuer.authorizeParams,
		code_challenge: await calculatePKCECodeChallenge(codeVerifier),
		code_challenge_method: "S256",
		nonce,
		redirect_uri: authnRequestUrlPublic(c.req.raw, callbackPath).href,
		state,
	});
	return c.redirect(url.href, 302);
};

export const authnRoutesSignInCallback = async ({
	authn,
	c,
	config,
}: {
	authn: AuthnState;
	c: Context;
	config: Configuration;
}): Promise<Response> => {
	const flowCookie = await authnCookieGet({
		c,
		key: authn.cookieKey,
		name: "flow",
	});
	authnCookieClear(c, "flow");
	const flow =
		flowCookie === undefined || flowCookie === "invalid"
			? undefined
			: FlowState.safeParse(JSON.parse(flowCookie)).data;
	if (flow === undefined) return c.html(authnSignInPageFailed("/"), 400);
	const currentUrl = authnRequestUrlPublic(c.req.raw, callbackPath);
	currentUrl.search = new URL(c.req.url).search;
	try {
		const tokens = await authorizationCodeGrant(config, currentUrl, {
			expectedNonce: flow.nonce,
			expectedState: flow.state,
			idTokenExpected: true,
			pkceCodeVerifier: flow.codeVerifier,
		});
		const stored = await authnRoutesTokensStore({
			c,
			authn,
			tokens: {
				accessToken: tokens.access_token,
				refreshToken: tokens.refresh_token,
			},
		});
		if (stored === undefined) {
			return c.html(authnSignInPageFailed(flow.returnTo), 400);
		}
		return c.redirect(flow.returnTo, 302);
	} catch (error) {
		if (!authnProviderRefusalIs(error)) throw error;
		logger.warn(
			{ err: error, route: callbackPath },
			"Sign-in refused by the provider",
		);
		return c.html(authnSignInPageFailed(flow.returnTo), 400);
	}
};
