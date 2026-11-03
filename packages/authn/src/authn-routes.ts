import { logger } from "@n8io/baseline-logger";
import { type Context, Hono } from "hono";
import {
	AuthorizationResponseError,
	authorizationCodeGrant,
	buildAuthorizationUrl,
	buildEndSessionUrl,
	ClientError,
	type Configuration,
	calculatePKCECodeChallenge,
	ResponseBodyError,
	randomNonce,
	randomPKCECodeVerifier,
	randomState,
	refreshTokenGrant,
	tokenRevocation,
	WWWAuthenticateChallengeError,
} from "openid-client";
import { z } from "zod";
import {
	authnCookieClear,
	authnCookieGet,
	authnCookieSet,
} from "./authn-cookie.ts";
import type { Authn, AuthnOidcIssuer, AuthnTokens } from "./authn-create.ts";
import { authnMemorySignInPage, authnSignInFailedPage } from "./authn-pages.ts";
import { authnPublicUrl, authnReturnToSafe } from "./authn-return-to.ts";

const FlowState = z.object({
	codeVerifier: z.string(),
	nonce: z.string(),
	returnTo: z.string(),
	state: z.string(),
});

const callbackPath = "/auth/callback";

// What the provider can refuse: an error in the callback or token response, or a check
// (state, nonce, PKCE, id token) that fails. Network failures are not in this list; they throw.
const isProviderRefusal = (error: unknown): boolean =>
	error instanceof AuthorizationResponseError ||
	error instanceof ResponseBodyError ||
	error instanceof WWWAuthenticateChallengeError ||
	error instanceof ClientError;

const returnToQuery = (c: Context): string =>
	authnReturnToSafe(c.req.query("returnTo"));

/** Verifies the new access token, then writes both cookies; returns its expiry, or `undefined` when it does not verify. */
const tokensStore = async (
	c: Context,
	authn: Authn,
	tokens: AuthnTokens,
): Promise<number | undefined> => {
	const verified = await authn.verify(tokens.accessToken);
	if (verified.status !== "valid") return undefined;
	await authnCookieSet(c, authn.cookieKey, "access", tokens.accessToken);
	if (tokens.refreshToken !== undefined) {
		await authnCookieSet(c, authn.cookieKey, "refresh", tokens.refreshToken);
	}
	return verified.expiresAt;
};

const signInStart = async (
	c: Context,
	authn: Authn,
	issuer: AuthnOidcIssuer,
	returnTo: string,
): Promise<Response> => {
	const codeVerifier = randomPKCECodeVerifier();
	const nonce = randomNonce();
	const state = randomState();
	await authnCookieSet(
		c,
		authn.cookieKey,
		"flow",
		JSON.stringify({ codeVerifier, nonce, returnTo, state }),
	);
	const url = buildAuthorizationUrl(issuer.config, {
		scope: "openid offline_access",
		...issuer.authorizeParams,
		code_challenge: await calculatePKCECodeChallenge(codeVerifier),
		code_challenge_method: "S256",
		nonce,
		redirect_uri: authnPublicUrl(c.req.raw, callbackPath).href,
		state,
	});
	return c.redirect(url.href, 302);
};

const callback = async (
	c: Context,
	authn: Authn,
	config: Configuration,
): Promise<Response> => {
	const flowCookie = await authnCookieGet(c, authn.cookieKey, "flow");
	authnCookieClear(c, "flow");
	const flow =
		flowCookie === undefined || flowCookie === "invalid"
			? undefined
			: FlowState.safeParse(JSON.parse(flowCookie)).data;
	if (flow === undefined) return c.html(authnSignInFailedPage("/"), 400);
	const currentUrl = authnPublicUrl(c.req.raw, callbackPath);
	currentUrl.search = new URL(c.req.url).search;
	try {
		const tokens = await authorizationCodeGrant(config, currentUrl, {
			expectedNonce: flow.nonce,
			expectedState: flow.state,
			idTokenExpected: true,
			pkceCodeVerifier: flow.codeVerifier,
		});
		const stored = await tokensStore(c, authn, {
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
		});
		if (stored === undefined) {
			return c.html(authnSignInFailedPage(flow.returnTo), 400);
		}
		return c.redirect(flow.returnTo, 302);
	} catch (error) {
		if (!isProviderRefusal(error)) throw error;
		logger.warn({ err: error, route: callbackPath });
		return c.html(authnSignInFailedPage(flow.returnTo), 400);
	}
};

const tokensRefresh = async (
	authn: Authn,
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
		if (!isProviderRefusal(error)) throw error;
		return undefined;
	}
};

/**
 * `GET /auth/refresh?returnTo=…` (a page whose token is expiring) refreshes both cookies and
 * redirects back, or to sign-in when the refresh fails. Without `returnTo` (the client
 * middleware's `fetch`) it answers `{ expiresAt }`, or 401.
 */
const refresh = async (c: Context, authn: Authn): Promise<Response> => {
	const returnTo = c.req.query("returnTo");
	const refreshToken = await authnCookieGet(c, authn.cookieKey, "refresh");
	const tokens =
		refreshToken === undefined || refreshToken === "invalid"
			? undefined
			: await tokensRefresh(authn, refreshToken);
	const expiresAt =
		tokens === undefined ? undefined : await tokensStore(c, authn, tokens);
	if (expiresAt === undefined) {
		authnCookieClear(c, "access");
		authnCookieClear(c, "refresh");
	}
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
		logger.warn({ err: error, route: "/auth/sign-out" });
	}
};

const signOut = async (c: Context, authn: Authn): Promise<Response> => {
	const refreshToken = await authnCookieGet(c, authn.cookieKey, "refresh");
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
		post_logout_redirect_uri: authnPublicUrl(c.req.raw, "/").href,
	});
	return c.redirect(endSession.href, 302);
};

const MemorySignIn = z.object({
	returnTo: z.string().optional(),
	who: z.enum(["admin", "user"]),
});

/** `/sign-in`, `/callback`, `/refresh` and `/sign-out`; mount with `app.route("/auth", authnRoutes(authn))`. */
export const authnRoutes = (authn: Authn): Hono => {
	const routes = new Hono();
	const { issuer } = authn;
	routes.use("*", async (c, next) => {
		await next();
		c.header("Cache-Control", "no-store");
	});
	routes.get("/sign-in", (c) =>
		issuer.kind === "memory"
			? c.html(authnMemorySignInPage(returnToQuery(c)))
			: signInStart(c, authn, issuer, returnToQuery(c)),
	);
	routes.get("/refresh", (c) => refresh(c, authn));
	routes.post("/sign-out", (c) => signOut(c, authn));
	if (issuer.kind === "memory") {
		routes.post("/sign-in", async (c) => {
			const form = MemorySignIn.safeParse(await c.req.parseBody());
			if (!form.success) return c.body(null, 400);
			const tokens = await issuer.tokensCreate(issuer.devActors[form.data.who]);
			if ((await tokensStore(c, authn, tokens)) === undefined) {
				throw new TypeError(
					"authn: actorFromClaims rejected a memory issuer token",
				);
			}
			return c.redirect(authnReturnToSafe(form.data.returnTo), 302);
		});
	} else {
		const { config } = issuer;
		routes.get("/callback", (c) => callback(c, authn, config));
	}
	return routes;
};
