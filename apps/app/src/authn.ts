// The one provider-specific file: switching providers edits this file and the AUTHN_* env vars.
import type {
	Actor,
	AuthnClaims,
	AuthnMemoryClient,
	AuthnMemoryUser,
	AuthnOptions,
} from "@n8io/baseline-authn";

type AuthnEnv = {
	AUTHN_AUDIENCE: string;
	AUTHN_CLIENT_ID: string;
	AUTHN_CLIENT_SECRET: string;
	AUTHN_ISSUER_URL: string;
	AUTHN_SECRET: string;
};

export const authnProviderOptionsCreate = (
	env: AuthnEnv,
): Omit<AuthnOptions, "actorFromClaims" | "memoryUsers"> => ({
	audience: env.AUTHN_AUDIENCE,
	// "client_id" for Cognito without a resource binding.
	audienceClaim: "aud",
	// Auth0: { audience: env.AUTHN_AUDIENCE }; Entra: { scope: "openid offline_access api://<app-id>/.default" }.
	authorizeParams: {},
	clientId: env.AUTHN_CLIENT_ID,
	clientSecret: env.AUTHN_CLIENT_SECRET,
	issuerUrl: env.AUTHN_ISSUER_URL,
	secret: env.AUTHN_SECRET,
});

/**
 * The users the memory issuer's sign-in page offers, in development and test only. Add one user per
 * role, each holding that role's scopes, so every role can be tried in the browser.
 */
export const authnMemoryUsersCreate = (scopes: string[]): AuthnMemoryUser[] => [
	{ id: "dev-user", name: "Dev user", scopes: [] },
	{ id: "dev-admin", name: "Dev admin", scopes },
];

/** The machine clients scripts fetch a token for: `authnMemoryTokenFetch({ clientId: "dev-client", url })`. */
export const authnMemoryClientsCreate = (
	scopes: string[],
): AuthnMemoryClient[] => [{ id: "dev-client", scopes }];

const scopesFromClaim = (value: unknown): string[] => {
	if (typeof value === "string") return value.split(" ").filter(Boolean);
	if (Array.isArray(value)) {
		return value.filter((scope): scope is string => typeof scope === "string");
	}
	return [];
};

/**
 * Maps the access token's claims to the Actor; pure, and a throw means "not an actor".
 * The default reads `sub`, space-separated `scope`, and marks machine tokens as clients:
 * `gty: "client-credentials"` (Auth0, the memory issuer) or a `sub` equal to the token's client.
 * Other providers:
 * - Entra: `oid` for the id, `scp` (users) or `roles` (apps) for scopes, `idtyp: "app"` for clients.
 * - Okta: `scp` is an array; client tokens have `sub` equal to `cid`.
 * - Keycloak: `scope` as here; client tokens have `azp` and a `service-account-` username.
 * - Cognito: `scope` as here; client tokens have `sub` equal to `client_id` and no `username`.
 * - Zitadel: `scope` as here; client tokens have `sub` equal to `client_id`.
 */
export const actorFromClaims = (claims: AuthnClaims): Actor => {
	const { sub } = claims;
	if (typeof sub !== "string" || sub === "") {
		throw new TypeError("The token has no sub claim");
	}
	const client = claims.client_id ?? claims.azp;
	const machine = claims.gty === "client-credentials" || sub === client;
	return {
		id: sub,
		kind: machine ? "client" : "user",
		scopes: scopesFromClaim(claims.scope),
	};
};
