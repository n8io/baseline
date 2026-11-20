import type { Actor } from "./actor.ts";
import { type Authn, authnState } from "./authn.ts";

/** Signs an access token for `actor` with the memory issuer, for the bearer calls of tests that hold the `Authn`. */
export const authnTestTokenCreate = async ({
	actor,
	authn,
}: {
	actor: Actor;
	authn: Authn;
}): Promise<string> => {
	const { issuer } = authnState(authn);
	if (issuer.kind !== "memory") {
		throw new TypeError(
			"authnTestTokenCreate: authn must use issuerUrl memory://",
		);
	}
	return (await issuer.tokensCreate(actor)).accessToken;
};
