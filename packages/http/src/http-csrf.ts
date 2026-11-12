import type { Context, MiddlewareHandler } from "hono";
import { csrf } from "hono/csrf";

// Behind a TLS proxy the request arrives as http, so the browser's https Origin would not match.
const httpPublicOrigin = (c: Context): string => {
	const url = new URL(c.req.url);
	if (c.req.header("x-forwarded-proto") === "https") url.protocol = "https:";
	return url.origin;
};

/**
 * `app.use(httpCsrf)` on cookie-authenticated routes: Hono's `csrf()` answers a form, multipart
 * or text POST with 403 unless `Sec-Fetch-Site` is `same-origin` or `Origin` is this server's
 * public origin (https when `x-forwarded-proto` says so). JSON and bearer requests pass.
 */
export const httpCsrf: MiddlewareHandler = csrf({
	origin: (origin, c) => origin === httpPublicOrigin(c),
});
