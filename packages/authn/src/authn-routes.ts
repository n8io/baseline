import { type Context, Hono } from "hono";
import { authnReturnToSafe } from "./authn-return-to.ts";
import {
	authnRoutesMemorySignIn,
	authnRoutesMemoryToken,
} from "./authn-routes-memory.ts";
import { authnRoutesRefresh } from "./authn-routes-refresh.ts";
import {
	authnRoutesSignInCallback,
	authnRoutesSignInStart,
} from "./authn-routes-sign-in.ts";
import { authnRoutesSignOut } from "./authn-routes-sign-out.ts";
import { authnSignInPageMemoryForm } from "./authn-sign-in-page.ts";
import { authnState } from "./authn-state.ts";
import type { Authn } from "./authn-types.ts";

const returnToQuery = (c: Context): string =>
	authnReturnToSafe(c.req.query("returnTo"));

/**
 * `/sign-in`, `/refresh` and `/sign-out`, plus `/callback` with an OIDC provider or `POST /token`
 * with the memory issuer.
 * Mount them at `/auth`, and nowhere else: `app.route("/auth", authnRoutesCreate(authn))`. The
 * middleware, cookie paths and page helpers all name `/auth`.
 */
export const authnRoutesCreate = (authn: Authn): Hono => {
	const routes = new Hono();
	const state = authnState(authn, "authnRoutesCreate");
	const { issuer } = state;
	routes.use("*", async (c, next) => {
		await next();
		c.header("Cache-Control", "no-store");
	});
	routes.get("/sign-in", (c) =>
		issuer.kind === "memory"
			? c.html(
					authnSignInPageMemoryForm({
						returnTo: returnToQuery(c),
						users: issuer.users,
					}),
				)
			: authnRoutesSignInStart({
					c,
					authn: state,
					issuer,
					returnTo: returnToQuery(c),
				}),
	);
	routes.get("/refresh", (c) => authnRoutesRefresh(c, state));
	routes.post("/sign-out", (c) => authnRoutesSignOut(c, state));
	if (issuer.kind === "memory") {
		routes.post("/sign-in", (c) =>
			authnRoutesMemorySignIn({ c, authn: state, issuer }),
		);
		routes.post("/token", (c) => authnRoutesMemoryToken({ c, issuer }));
	} else {
		const { config } = issuer;
		routes.get("/callback", (c) =>
			authnRoutesSignInCallback({ c, authn: state, config }),
		);
	}
	return routes;
};
