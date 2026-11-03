import type { Context } from "hono";
import { type RouterContextProvider, redirectDocument } from "react-router";
import { type Actor, actorContext } from "./actor.ts";
import { AuthnRequiredError } from "./authn-errors.ts";
import { authnPagePath } from "./authn-return-to.ts";

type RouterArgs = {
	context: Readonly<RouterContextProvider>;
	request: Request;
};

/** The signed-in actor of an API request; throws `AuthnRequiredError` (401) when there is none. */
export function authnActorRequire(c: Context): Actor;
/**
 * The signed-in actor of a loader or action (pass its args); throws a document redirect to
 * `/auth/sign-in?returnTo=<this page>` when there is none.
 */
export function authnActorRequire(args: RouterArgs): Actor;
export function authnActorRequire(target: Context | RouterArgs): Actor {
	if ("req" in target) {
		const actor = target.var.actor;
		if (actor === undefined) throw new AuthnRequiredError();
		return actor;
	}
	const actor = target.context.get(actorContext);
	if (actor !== undefined) return actor;
	const returnTo = authnPagePath(new URL(target.request.url));
	throw redirectDocument(
		`/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`,
	);
}
