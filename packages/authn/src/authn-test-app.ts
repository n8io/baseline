import { httpErrorHandle } from "@n8io/baseline-http";
import { type Context, Hono } from "hono";
import { except } from "hono/combine";
import { memoryOptions } from "./authn-test-helpers.ts";
import {
	type Authn,
	type AuthnOptions,
	authnActorRequire,
	authnCreate,
	authnMiddlewareCreate,
	authnRoutesCreate,
} from "./index.ts";

/** Wires authn the way `src/server.ts` does, with one API route and one page route. */
export const authnTestAppCreate = async (
	options: AuthnOptions = memoryOptions,
): Promise<{ app: Hono; authn: Authn }> => {
	const authn = await authnCreate(options);
	const app = new Hono();
	app.onError(httpErrorHandle);
	app.use(
		"*",
		except(["/api/*"], authnMiddlewareCreate(authn, { source: "cookie" })),
	);
	app.use("/api/v1/*", authnMiddlewareCreate(authn, { source: "bearer" }));
	app.route("/auth", authnRoutesCreate(authn));
	app.get("/api/v1/me", (c) => c.json(authnActorRequire(c)));
	app.get("/api/v1/whoami", (c) => c.json({ actor: c.var.actor ?? null }));
	const page = (c: Context): Response =>
		c.json({
			actor: c.var.actor ?? null,
			expiresAt: c.var.authnExpiresAt ?? null,
		});
	app.get("/foos", page);
	app.get("/foos.data", page);
	app.post("/foos", page);
	return { app, authn };
};
