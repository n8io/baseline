import type { Actor } from "./actor.ts";
import { type Authn, authnState } from "./authn.ts";

/** What `authnTestTokenCreate` takes. */
export type AuthnTestTokenOptions = {
	/** The Actor the token is for. */
	actor: Actor;
	/** A memory issuer `Authn`. */
	authn: Authn;
};

/** Signs an access token for `actor` with the memory issuer, for the bearer calls of tests that hold the `Authn`. */
export const authnTestTokenCreate = async ({
	actor,
	authn,
}: AuthnTestTokenOptions): Promise<string> => {
	const { issuer } = authnState(authn, "authnTestTokenCreate");
	if (issuer.kind !== "memory") {
		throw new TypeError(
			"authnTestTokenCreate: authn must use issuerUrl memory://",
		);
	}
	return (await issuer.tokensCreate(actor)).accessToken;
};
