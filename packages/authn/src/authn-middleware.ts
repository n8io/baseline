import { trace } from "@opentelemetry/api";
import type { Context, MiddlewareHandler } from "hono";
import type { Actor } from "./actor.ts";
import {
	type Authn,
	type AuthnState,
	type AuthnVerified,
	authnState,
} from "./authn.ts";
import { authnCookieClear, authnCookieGet } from "./authn-cookie.ts";
import { AuthnInvalidError } from "./authn-errors.ts";
import {
	authnRequestUrlDataIs,
	authnRequestUrlPagePath,
} from "./authn-request-url.ts";

declare module "hono" {
	interface ContextVariableMap {
		/** The signed-in Actor, or `undefined`; set only by `authnMiddlewareCreate`. */
		actor: Actor | undefined;
		/** When the access token expires, in epoch ms. */
		authnExpiresAt: number | undefined;
	}
}

// A page GET whose token expires within this window refreshes first, so the token does not
// lapse while the request runs.
const refreshWindowMs = 10_000;

/**
 * Redirects a page request. React Router's client-side data requests (`/foos.data`) cannot follow
 * a cross-site redirect, so they get its 204 redirect headers and load the target as a document.
 */
const authnPageRedirect = (c: Context, path: string): Response => {
	const target = `${path}?returnTo=${encodeURIComponent(authnRequestUrlPagePath(new URL(c.req.url)))}`;
	if (!authnRequestUrlDataIs(new URL(c.req.url)))
		return c.redirect(target, 302);
	return c.body(null, 204, {
		"X-Remix-Redirect": target,
		"X-Remix-Reload-Document": "true",
	});
};

const authnSignedIn = (
	c: Context,
	verified: Extract<AuthnVerified, { status: "valid" }>,
): void => {
	c.set("actor", verified.actor);
	c.set("authnExpiresAt", verified.expiresAt);
	trace.getActiveSpan()?.setAttribute("user.id", verified.actor.id);
};

const bearerMiddleware =
	(authn: AuthnState): MiddlewareHandler =>
	async (c, next) => {
		c.set("actor", undefined);
		c.set("authnExpiresAt", undefined);
		const header = c.req.header("Authorization");
		if (header === undefined) return next();
		const match = /^Bearer ([^\s]+)$/i.exec(header);
		const verified = match?.[1]
			? await authn.verify(match[1])
			: ({ status: "invalid" } as const);
		if (verified.status !== "valid") throw new AuthnInvalidError();
		authnSignedIn(c, verified);
		return next();
	};

const cookieMiddleware =
	(authn: AuthnState): MiddlewareHandler =>
	async (c, next) => {
		c.set("actor", undefined);
		c.set("authnExpiresAt", undefined);
		// The authn routes read their own cookies; checking here could redirect them to themselves.
		if (c.req.path === "/auth" || c.req.path.startsWith("/auth/")) {
			return next();
		}
		const token = await authnCookieGet({
			c,
			key: authn.cookieKey,
			name: "access",
		});
		if (token === undefined) return next();
		const verified =
			token === "invalid"
				? ({ status: "invalid" } as const)
				: await authn.verify(token);
		if (verified.status === "invalid") {
			authnCookieClear(c, "access");
			authnCookieClear(c, "refresh");
			return authnPageRedirect(c, "/auth/sign-in");
		}
		const expiring =
			verified.status === "expired" ||
			verified.expiresAt - Date.now() < refreshWindowMs;
		if (expiring) {
			if (c.req.method === "GET" || c.req.method === "HEAD") {
				return authnPageRedirect(c, "/auth/refresh");
			}
			// A form post without JavaScript cannot be replayed after a refresh (accepted).
			authnCookieClear(c, "access");
			return authnPageRedirect(c, "/auth/sign-in");
		}
		authnSignedIn(c, verified);
		return next();
	};

/** What `authnMiddlewareCreate` takes as its second argument. */
export type AuthnMiddlewareOptions = {
	/** Where the token comes from: the `Authorization` header or the cookies. */
	source: "bearer" | "cookie";
};

/**
 * Sets `c.var.actor` and `c.var.authnExpiresAt`, or leaves them `undefined` when no token is
 * sent; it never rejects a missing token. A present but invalid token is never anonymous:
 * `"bearer"` throws `AuthnInvalidError` (401), `"cookie"` clears the cookies and redirects to
 * sign-in. A page GET with an expiring cookie token redirects to `/auth/refresh` first.
 */
export const authnMiddlewareCreate = (
	authn: Authn,
	options: AuthnMiddlewareOptions,
): MiddlewareHandler =>
	options.source === "bearer"
		? bearerMiddleware(authnState(authn, "authnMiddlewareCreate"))
		: cookieMiddleware(authnState(authn, "authnMiddlewareCreate"));
