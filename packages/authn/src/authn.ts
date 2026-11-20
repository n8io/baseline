import {
	createRemoteJWKSet,
	errors,
	type JWTPayload,
	type JWTVerifyGetKey,
	jwtVerify,
	SignJWT,
} from "jose";
import { type Configuration, discovery } from "openid-client";
import type { Actor } from "./actor.ts";
import { actorSchema } from "./actor-schema.ts";
import { authnCookieKey } from "./authn-cookie.ts";
import { authnSecretKeyDerive } from "./authn-secret-key.ts";

/** The claims of a verified access token, as the provider sent them. */
export type AuthnClaims = Record<string, unknown>;

/** A person the memory issuer's sign-in page offers. */
export type AuthnMemoryUser = { id: string; name: string; scopes: string[] };

/** A machine client the memory issuer's `POST /auth/token` signs tokens for. */
export type AuthnMemoryClient = { id: string; scopes: string[] };

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
	/** `"client_id"` for a provider that names the client in `client_id` instead of `aud`: that claim must then equal `audience`. Default `"aud"`. */
	audienceClaim?: "aud" | "client_id" | null;
	/** Maps the verified access token's claims to the Actor; a throw means "not an Actor". */
	actorFromClaims: (claims: AuthnClaims) => Actor;
	/** The people the memory issuer's sign-in page offers; when unset or empty, one `dev-user` without scopes. */
	memoryUsers?: AuthnMemoryUser[] | null;
	/** The machine clients the memory issuer's `POST /auth/token` serves; default none. */
	memoryClients?: AuthnMemoryClient[] | null;
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
	clients: AuthnMemoryClient[];
	users: AuthnMemoryUser[];
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

const authnStates = new WeakMap<Authn, AuthnState>();

/** The state behind an `Authn`; throws a `TypeError` for anything `authnCreate` did not return. */
export const authnState = (authn: Authn, caller: string): AuthnState => {
	const state = authnStates.get(authn);
	if (state === undefined) {
		throw new TypeError(`${caller}: authn must come from authnCreate`);
	}
	return state;
};

const authnFromState = (state: AuthnState): Authn => {
	const authn = Object.freeze({}) as Authn;
	authnStates.set(authn, state);
	return authn;
};

const memoryIssuerUrl = "memory://";
const memoryAccessTtlSeconds = 15 * 60;
const memoryAlgorithm = "HS256";
const memoryRefreshTtl = "30d";
const memoryRefreshAudience = "baseline-authn-memory-refresh";

const authnIssuerUrlCheck = (options: AuthnOptions): void => {
	if (options.issuerUrl === memoryIssuerUrl) {
		if (options.memoryIssuerAllowed === true) return;
		throw new TypeError(
			"authnCreate: issuerUrl memory:// signs anyone in without a password; pass memoryIssuerAllowed: true, in development and test only",
		);
	}
	if (options.issuerUrl.startsWith("https://")) return;
	throw new TypeError(
		"authnCreate: issuerUrl must start with https:// or be memory://",
	);
};

// What jose throws for a token that is wrong in itself. Anything else, such as a JWKS fetch that
// fails, times out, answers non-200 or returns a bad key set, is an outage (500), never a reason
// to treat a caller as signed out.
const tokenErrors = [
	errors.JWTClaimValidationFailed,
	errors.JWTInvalid,
	errors.JWSInvalid,
	errors.JWSSignatureVerificationFailed,
	errors.JOSEAlgNotAllowed,
	errors.JOSENotSupported,
	errors.JWKSNoMatchingKey,
	errors.JWKSMultipleMatchingKeys,
];

const authnTokenErrorIs = (error: unknown): boolean =>
	tokenErrors.some((tokenError) => error instanceof tokenError);

// `actorFromClaims` is the Project's pure mapping; a throw means the claims are not an Actor.
const authnActorFrom = (
	options: AuthnOptions,
	payload: JWTPayload,
): Actor | undefined => {
	try {
		return actorSchema.safeParse(options.actorFromClaims(payload)).data;
	} catch {
		return undefined;
	}
};

const authnVerifyCreate =
	({
		algorithms,
		issuer,
		jwks,
		options,
	}: {
		algorithms?: string[];
		issuer: string;
		jwks: JWTVerifyGetKey;
		options: AuthnOptions;
	}): AuthnState["verify"] =>
	async (accessToken) => {
		let payload: JWTPayload;
		try {
			({ payload } = await jwtVerify(accessToken, jwks, {
				...(algorithms === undefined ? {} : { algorithms }),
				issuer,
				requiredClaims: ["exp"],
				...(options.audienceClaim === "client_id"
					? {}
					: { audience: options.audience }),
			}));
		} catch (error) {
			if (error instanceof errors.JWTExpired) return { status: "expired" };
			if (authnTokenErrorIs(error)) return { status: "invalid" };
			throw error;
		}
		if (
			options.audienceClaim === "client_id" &&
			payload.client_id !== options.audience
		) {
			return { status: "invalid" };
		}
		const actor = authnActorFrom(options, payload);
		if (actor === undefined) return { status: "invalid" };
		return {
			actor,
			expiresAt: (payload.exp ?? 0) * 1000,
			status: "valid",
		};
	};

// The claims a provider would issue for this Actor, in the shape the Template's default
// `actorFromClaims` reads (`sub`, space-separated `scope`, `gty` for machine tokens).
const authnMemoryClaims = (
	options: AuthnOptions,
	actor: Actor,
): JWTPayload => ({
	client_id: options.clientId,
	scope: actor.scopes.join(" "),
	...(actor.kind === "client" ? { gty: "client-credentials" } : {}),
});

const memoryUsersDefault: AuthnMemoryUser[] = [
	{ id: "dev-user", name: "Dev user", scopes: [] },
];

const authnIdsUniqueCheck = (
	field: "memoryClients" | "memoryUsers",
	entries: { id: string }[],
): void => {
	const ids = entries.map((entry) => entry.id);
	const repeated = ids.find((id, index) => ids.indexOf(id) !== index);
	if (repeated !== undefined) {
		throw new TypeError(
			`authnCreate: ${field} lists the id "${repeated}" twice`,
		);
	}
};

// HS256 with a key derived from `secret`, so every Server that shares the secret verifies the
// tokens of every other: a token signed at one pod, or fetched by a script, works at the next.
const authnMemoryIssuerCreate = (
	options: AuthnOptions,
): { issuer: AuthnMemoryIssuer; key: Uint8Array } => {
	const users =
		options.memoryUsers == null || options.memoryUsers.length === 0
			? memoryUsersDefault
			: options.memoryUsers;
	const clients = options.memoryClients ?? [];
	authnIdsUniqueCheck("memoryUsers", users);
	authnIdsUniqueCheck("memoryClients", clients);
	const key = authnSecretKeyDerive({
		info: "baseline-authn-memory-issuer",
		secret: options.secret,
	});
	const sign = ({
		audience,
		claims,
		subject,
		ttl,
	}: {
		audience: string;
		claims: JWTPayload;
		subject: string;
		ttl: string;
	}): Promise<string> =>
		new SignJWT(claims)
			.setProtectedHeader({ alg: memoryAlgorithm })
			.setIssuer(memoryIssuerUrl)
			.setSubject(subject)
			.setAudience(audience)
			.setIssuedAt()
			.setExpirationTime(ttl)
			.sign(key);
	const tokensFromClaims = async (
		claims: JWTPayload,
		subject: string,
	): Promise<AuthnTokens> => ({
		accessToken: await sign({
			claims,
			subject,
			audience: options.audience,
			ttl: `${memoryAccessTtlSeconds}s`,
		}),
		// Only `sub`: refresh re-reads the user, and without `client_id` or `scope` a refresh token
		// never passes as an access token, even with `audienceClaim: "client_id"`.
		refreshToken: await sign({
			claims: {},
			subject,
			audience: memoryRefreshAudience,
			ttl: memoryRefreshTtl,
		}),
	});
	return {
		issuer: {
			accessTtlSeconds: memoryAccessTtlSeconds,
			clients,
			kind: "memory",
			tokensCreate: (actor) =>
				tokensFromClaims(authnMemoryClaims(options, actor), actor.id),
			tokensRefresh: async (refreshToken) => {
				try {
					const { payload } = await jwtVerify(refreshToken, key, {
						algorithms: [memoryAlgorithm],
						audience: memoryRefreshAudience,
						issuer: memoryIssuerUrl,
					});
					// Re-read the user, so a changed or removed entry takes effect at the next refresh.
					const user = users.find((entry) => entry.id === payload.sub);
					return user === undefined
						? undefined
						: await tokensFromClaims(
								authnMemoryClaims(options, {
									id: user.id,
									kind: "user",
									scopes: user.scopes,
								}),
								user.id,
							);
				} catch {
					return undefined;
				}
			},
			users,
		},
		key,
	};
};

const authnOidcIssuerCreate = async (
	options: AuthnOptions,
): Promise<{
	issuer: AuthnOidcIssuer;
	issuerId: string;
	jwks: JWTVerifyGetKey;
}> => {
	const config = await discovery(
		new URL(options.issuerUrl),
		options.clientId,
		options.clientSecret,
	);
	const metadata = config.serverMetadata();
	if (metadata.jwks_uri === undefined) {
		throw new TypeError("authnCreate: the issuer advertises no jwks_uri");
	}
	return {
		issuer: {
			authorizeParams: options.authorizeParams ?? {},
			config,
			kind: "oidc",
		},
		issuerId: metadata.issuer,
		jwks: createRemoteJWKSet(new URL(metadata.jwks_uri)),
	};
};

/**
 * Discovers the provider (or starts the memory issuer for `memory://`) and returns what the
 * routes, middleware and `authnTestTokenCreate` need. Throws on a secret under 32 bytes, a
 * URL scheme other than https:// or memory://, memory:// without `memoryIssuerAllowed`, an id
 * listed twice in `memoryUsers` or `memoryClients`, or an unreachable provider.
 */
export const authnCreate = async (options: AuthnOptions): Promise<Authn> => {
	authnIssuerUrlCheck(options);
	const cookieKey = authnCookieKey(options.secret);
	if (options.issuerUrl === memoryIssuerUrl) {
		const { issuer, key } = authnMemoryIssuerCreate(options);
		return authnFromState({
			clientId: options.clientId,
			cookieKey,
			issuer,
			verify: authnVerifyCreate({
				algorithms: [memoryAlgorithm],
				issuer: memoryIssuerUrl,
				jwks: async () => key,
				options,
			}),
		});
	}
	const { issuer, issuerId, jwks } = await authnOidcIssuerCreate(options);
	return authnFromState({
		clientId: options.clientId,
		cookieKey,
		issuer,
		verify: authnVerifyCreate({ options, jwks, issuer: issuerId }),
	});
};
