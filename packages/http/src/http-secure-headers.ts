import type { MiddlewareHandler } from "hono";
import { NONCE, secureHeaders } from "hono/secure-headers";

/** What `httpSecureHeadersCreate` takes. */
export type HttpSecureHeadersOptions = {
	/**
	 * Origins the page's own scripts may fetch, stream from or send events to, such as
	 * `https://api.example.com`. `'self'` is always allowed; nothing else is without this.
	 */
	readonly connectSrc?: readonly string[] | null;
};

/**
 * `app.use(httpSecureHeadersCreate({ connectSrc }))`: Hono's secure headers (HSTS, nosniff,
 * Referrer-Policy and the rest) plus an enforced CSP whose `script-src` takes a fresh nonce per
 * request, read with `c.get("secureHeadersNonce")`, and whose `connect-src` is `'self'` plus the
 * origins given.
 */
export const httpSecureHeadersCreate = ({
	connectSrc,
}: HttpSecureHeadersOptions = {}): MiddlewareHandler =>
	secureHeaders({
		contentSecurityPolicy: {
			baseUri: ["'self'"],
			connectSrc: ["'self'", ...(connectSrc ?? [])],
			defaultSrc: ["'self'"],
			frameAncestors: ["'none'"],
			objectSrc: ["'none'"],
			scriptSrc: ["'self'", NONCE],
		},
	});

/** `app.use(httpSecureHeaders)`: `httpSecureHeadersCreate()` with no extra origins. */
export const httpSecureHeaders: MiddlewareHandler = httpSecureHeadersCreate();
