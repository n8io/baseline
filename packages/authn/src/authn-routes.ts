import { type Context, Hono } from "hono";
import { authnReturnToSafe } from "./authn-return-to.ts";
import { memorySignIn, memoryToken } from "./authn-routes-memory.ts";
import { refresh } from "./authn-routes-refresh.ts";
import { callback, signInStart } from "./authn-routes-sign-in.ts";
import { signOut } from "./authn-routes-sign-out.ts";
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
			: signInStart({ c, authn: state, issuer, returnTo: returnToQuery(c) }),
	);
	routes.get("/refresh", (c) => refresh(c, state));
	routes.post("/sign-out", (c) => signOut(c, state));
	if (issuer.kind === "memory") {
		routes.post("/sign-in", (c) => memorySignIn({ c, authn: state, issuer }));
		routes.post("/token", (c) => memoryToken({ c, issuer }));
	} else {
		const { config } = issuer;
		routes.get("/callback", (c) => callback({ c, authn: state, config }));
	}
	return routes;
};
