import { trace } from "@opentelemetry/api";
import type { MiddlewareHandler } from "hono";
import { routePath } from "hono/route";

/**
 * `app.use(httpRouteName)`: names the HTTP server span after the route that answered
 * (`POST /api/v1/foos`) and sets `http.route`. Catch-all routes (a pattern ending in `*`, such as
 * the UI's or the API's not-found route) keep the name something else gave them.
 */
export const httpRouteName: MiddlewareHandler = async (c, next) => {
	await next();
	const route = routePath(c);
	if (route.endsWith("*")) return;
	const span = trace.getActiveSpan();
	span?.updateName(`${c.req.method} ${route}`);
	span?.setAttribute("http.route", route);
};
