import type { Configuration } from "openid-client";
import type { Actor } from "./actor.ts";

/** The claims of a verified access token, as the provider sent them. */
export type AuthnClaims = Record<string, unknown>;

/** A person the memory issuer's sign-in page offers. */
export type AuthnMemoryUser = {
	readonly id: string;
	readonly name: string;
	readonly scopes: readonly string[];
};

/** A machine client the memory issuer's `POST /auth/token` signs tokens for. */
export type AuthnMemoryClient = {
	readonly id: string;
	readonly scopes: readonly string[];
};

/** What `authnCreate` takes. */
export type AuthnOptions = {
	/** The provider's issuer, `https://…`, or `memory://` for the memory issuer. */
	issuerUrl: string;
	/** The Project's client at the provider. */
	clientId: string;
	/** The client's secret at the provider. */
	clientSecret: string;
	/** The `aud` every access token must carry. */
	audience: string;
	/** Base64url, at least 32 bytes; encrypts every authn cookie and keys the memory issuer. */
	secret: string;
	/** Extra authorization request params, such as `{ audience }` for a provider that asks for one. */
	authorizeParams?: Record<string, string> | null;
	/** `"client_id"` for a provider that names the client in `client_id` instead of `aud`: that claim must then equal `audience`. Default `"aud"`; any other value throws a `TypeError`. */
	audienceClaim?: "aud" | "client_id" | null;
	/** Maps the verified access token's claims to the Actor; a throw means "not an Actor". */
	actorFromClaims: (claims: AuthnClaims) => Actor;
	/** The people the memory issuer's sign-in page offers; when unset or empty, one `dev-user` without scopes. */
	memoryUsers?: readonly AuthnMemoryUser[] | null;
	/** The machine clients the memory issuer's `POST /auth/token` serves; default none. */
	memoryClients?: readonly AuthnMemoryClient[] | null;
	/** Sends every request to an OIDC provider: discovery, key set, token, revocation. `null` means the global `fetch`. Unused with `memory://`. */
	fetch?: typeof fetch | null;
	/** Must be `true` for `issuerUrl: "memory://"`; pass it only in development and test. */
	memoryIssuerAllowed?: boolean | null;
};

/** What verifying an access token found. */
export type AuthnVerified =
	| { status: "valid"; actor: Actor; expiresAt: number }
	| { status: "expired" }
	| { status: "invalid" };

/** The tokens a grant or refresh returns. */
export type AuthnTokens = {
	accessToken: string;
	refreshToken: string | undefined;
};

/** The memory issuer of `issuerUrl` `memory://`. */
export type AuthnMemoryIssuer = {
	kind: "memory";
	accessTtlSeconds: number;
	clients: readonly AuthnMemoryClient[];
	users: readonly AuthnMemoryUser[];
	tokensCreate: (actor: Actor) => Promise<AuthnTokens>;
	tokensRefresh: (refreshToken: string) => Promise<AuthnTokens | undefined>;
};

/** A discovered OIDC provider. */
export type AuthnOidcIssuer = {
	kind: "oidc";
	authorizeParams: Record<string, string>;
	config: Configuration;
};

declare const authnBrand: unique symbol;

/** What `authnCreate` returns. Pass it to the other authn functions; it has no fields of its own. */
export type Authn = { readonly [authnBrand]: true };

/** What the other modules of this Package reach through an Authn. */
export type AuthnState = {
	readonly clientId: string;
	readonly cookieKey: Uint8Array;
	readonly issuer: AuthnMemoryIssuer | AuthnOidcIssuer;
	readonly verify: (accessToken: string) => Promise<AuthnVerified>;
};
