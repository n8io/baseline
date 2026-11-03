import { createContext, type RouterContext } from "react-router";
import { z } from "zod";

/** Who is performing a use case: a signed-in user or a machine client. */
export type Actor = { id: string; kind: "user" | "client"; scopes: string[] };

export const Actor: z.ZodType<Actor> = z.object({
	id: z.string().min(1),
	kind: z.enum(["user", "client"]),
	scopes: z.array(z.string()),
});

/** The signed-in actor for a page request, or `undefined` when nobody is signed in. */
export const actorContext: RouterContext<Actor | undefined> = createContext<
	Actor | undefined
>(undefined);

/** When the page request's access token expires, in epoch ms. The root loader returns it as `authnExpiresAt`. */
export const authnExpiryContext: RouterContext<number | undefined> =
	createContext<number | undefined>(undefined);
