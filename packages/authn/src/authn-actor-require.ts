import type { Context } from "hono";
import type { Actor } from "./actor.ts";
import { AuthnRequiredError } from "./authn-errors.ts";

/** The signed-in actor of an API request; throws `AuthnRequiredError` (401) when there is none. */
export const authnActorRequire = (c: Context): Actor => {
	const actor = c.var.actor;
	if (actor === undefined) throw new AuthnRequiredError();
	return actor;
};
