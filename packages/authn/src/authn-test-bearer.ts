import { randomBytes } from "node:crypto";
import type { Actor } from "./actor.ts";
import {
	type Authn,
	type AuthnClaims,
	authnCreate,
	authnMemoryTokenCreate,
} from "./authn.ts";

export type AuthnTestBearer = {
	/** Pass to `authnMiddlewareCreate(authn, { source: "bearer" })` in the app under test. */
	authn: Authn;
	/** A memory issuer access token for `actor`, for an `Authorization: Bearer` header. */
	tokenFor: (actor: Actor) => Promise<string>;
};

/**
 * A memory issuer `Authn` with its own random secret, and bearer tokens for any Actor, for route
 * tests that build their own app. `actorFromClaims` is the app's own mapping.
 */
export const authnTestBearerCreate = async ({
	actorFromClaims,
}: {
	actorFromClaims: (claims: AuthnClaims) => Actor;
}): Promise<AuthnTestBearer> => {
	const authn = await authnCreate({
		actorFromClaims,
		audience: "test",
		clientId: "test",
		clientSecret: "test",
		issuerUrl: "memory://",
		memoryIssuerAllowed: true,
		secret: randomBytes(32).toString("base64url"),
	});
	return {
		authn,
		tokenFor: (actor) => authnMemoryTokenCreate({ actor, authn }),
	};
};
