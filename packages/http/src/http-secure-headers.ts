import type { MiddlewareHandler } from "hono";
import { NONCE, secureHeaders } from "hono/secure-headers";

/**
 * `app.use(httpSecureHeaders)`: Hono's secure headers (HSTS, nosniff, Referrer-Policy and the
 * rest) plus an enforced CSP whose `script-src` takes a fresh nonce per request, read with
 * `c.get("secureHeadersNonce")`.
 */
export const httpSecureHeaders: MiddlewareHandler = secureHeaders({
	contentSecurityPolicy: {
		baseUri: ["'self'"],
		defaultSrc: ["'self'"],
		frameAncestors: ["'none'"],
		objectSrc: ["'none'"],
		scriptSrc: ["'self'", NONCE],
	},
});
