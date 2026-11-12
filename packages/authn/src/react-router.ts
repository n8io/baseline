import {
	createContext,
	type RouterContext,
	type RouterContextProvider,
	redirectDocument,
} from "react-router";
import type { Actor } from "./actor.ts";
import { authnPagePath } from "./authn-return-to.ts";

/** The signed-in actor for a page request, or `undefined` when nobody is signed in. */
export const actorContext: RouterContext<Actor | undefined> = createContext<
	Actor | undefined
>(undefined);

/** When the page request's access token expires, in epoch ms. The root loader returns it as `authnExpiresAt`. */
export const authnExpiryContext: RouterContext<number | undefined> =
	createContext<number | undefined>(undefined);

/**
 * The signed-in actor of a loader or action (pass its args); throws a document redirect to
 * `/auth/sign-in?returnTo=<this page>` when there is none.
 */
export const authnPageActorRequire = (args: {
	context: Readonly<RouterContextProvider>;
	request: Request;
}): Actor => {
	const actor = args.context.get(actorContext);
	if (actor !== undefined) return actor;
	const returnTo = authnPagePath(new URL(args.request.url));
	throw redirectDocument(
		`/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`,
	);
};
