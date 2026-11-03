import {
	createLocalJWKSet,
	createRemoteJWKSet,
	errors,
	exportJWK,
	generateKeyPair,
	type JWTPayload,
	type JWTVerifyGetKey,
	jwtVerify,
	SignJWT,
} from "jose";
import { type Configuration, discovery } from "openid-client";
import { Actor } from "./actor.ts";
import { authnCookieKey } from "./authn-cookie.ts";

export type AuthnOptions = {
	issuerUrl: string;
	clientId: string;
	clientSecret: string;
	audience: string;
	/** Base64url, at least 32 bytes; encrypts every authn cookie. */
	secret: string;
	/** Extra authorization request params, such as `{ audience }` for Auth0. */
	authorizeParams?: Record<string, string>;
	/** `"client_id"` for Cognito without a resource binding: the token's `client_id` must then equal `audience`. */
	audienceClaim?: "aud" | "client_id";
	actorFromClaims: (claims: JWTPayload) => Actor;
	/** Scopes of the memory issuer's "Dev admin". */
	memoryAdminScopes?: string[];
};

export type AuthnVerified =
	| { status: "valid"; actor: Actor; expiresAt: number }
	| { status: "expired" }
	| { status: "invalid" };

export type AuthnTokens = {
	accessToken: string;
	refreshToken: string | undefined;
};

export type AuthnMemoryIssuer = {
	kind: "memory";
	devActors: { admin: Actor; user: Actor };
	tokensCreate: (actor: Actor) => Promise<AuthnTokens>;
	tokensRefresh: (refreshToken: string) => Promise<AuthnTokens | undefined>;
};

export type AuthnOidcIssuer = {
	kind: "oidc";
	authorizeParams: Record<string, string>;
	config: Configuration;
};

/** What `authnCreate` returns. Pass it to the other authn functions; its fields are internal. */
export type Authn = {
	readonly clientId: string;
	readonly cookieKey: Uint8Array;
	readonly issuer: AuthnMemoryIssuer | AuthnOidcIssuer;
	readonly verify: (accessToken: string) => Promise<AuthnVerified>;
};

const memoryIssuerUrl = "memory://";
const memoryAccessTtl = "15m";
const memoryRefreshTtl = "30d";
const memoryRefreshAudience = "baseline-authn-memory-refresh";

const issuerUrlCheck = (issuerUrl: string): void => {
	if (issuerUrl === memoryIssuerUrl || issuerUrl.startsWith("https://")) return;
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

const isTokenError = (error: unknown): boolean =>
	tokenErrors.some((tokenError) => error instanceof tokenError);

// `actorFromClaims` is the app's pure mapping; a throw means the claims are not an actor.
const actorFrom = (
	options: AuthnOptions,
	payload: JWTPayload,
): Actor | undefined => {
	try {
		return Actor.safeParse(options.actorFromClaims(payload)).data;
	} catch {
		return undefined;
	}
};

const verifyCreate =
	(
		options: AuthnOptions,
		jwks: JWTVerifyGetKey,
		issuer: string,
	): Authn["verify"] =>
	async (accessToken) => {
		let payload: JWTPayload;
		try {
			({ payload } = await jwtVerify(accessToken, jwks, {
				issuer,
				requiredClaims: ["exp"],
				...(options.audienceClaim === "client_id"
					? {}
					: { audience: options.audience }),
			}));
		} catch (error) {
			if (error instanceof errors.JWTExpired) return { status: "expired" };
			if (isTokenError(error)) return { status: "invalid" };
			throw error;
		}
		if (
			options.audienceClaim === "client_id" &&
			payload.client_id !== options.audience
		) {
			return { status: "invalid" };
		}
		const actor = actorFrom(options, payload);
		if (actor === undefined) return { status: "invalid" };
		return {
			actor,
			expiresAt: (payload.exp ?? 0) * 1000,
			status: "valid",
		};
	};

// The claims a provider would issue for this actor, in the shape the template's default
// `actorFromClaims` reads (`sub`, space-separated `scope`, `gty` for machine tokens).
const memoryClaims = (options: AuthnOptions, actor: Actor): JWTPayload => ({
	client_id: options.clientId,
	scope: actor.scopes.join(" "),
	...(actor.kind === "client" ? { gty: "client-credentials" } : {}),
});

const memoryIssuerCreate = async (
	options: AuthnOptions,
): Promise<{ issuer: AuthnMemoryIssuer; jwks: JWTVerifyGetKey }> => {
	const { privateKey, publicKey } = await generateKeyPair("ES256");
	const kid = "memory";
	const jwks = createLocalJWKSet({
		keys: [{ ...(await exportJWK(publicKey)), alg: "ES256", kid }],
	});
	const sign = (
		claims: JWTPayload,
		subject: string,
		audience: string,
		ttl: string,
	): Promise<string> =>
		new SignJWT(claims)
			.setProtectedHeader({ alg: "ES256", kid })
			.setIssuer(memoryIssuerUrl)
			.setSubject(subject)
			.setAudience(audience)
			.setIssuedAt()
			.setExpirationTime(ttl)
			.sign(privateKey);
	const tokensFromClaims = async (
		claims: JWTPayload,
		subject: string,
	): Promise<AuthnTokens> => ({
		accessToken: await sign(claims, subject, options.audience, memoryAccessTtl),
		refreshToken: await sign(
			claims,
			subject,
			memoryRefreshAudience,
			memoryRefreshTtl,
		),
	});
	return {
		issuer: {
			devActors: {
				admin: {
					id: "dev-admin",
					kind: "user",
					scopes: options.memoryAdminScopes ?? [],
				},
				user: { id: "dev-user", kind: "user", scopes: [] },
			},
			kind: "memory",
			tokensCreate: (actor) =>
				tokensFromClaims(memoryClaims(options, actor), actor.id),
			tokensRefresh: async (refreshToken) => {
				try {
					const { payload } = await jwtVerify(refreshToken, jwks, {
						audience: memoryRefreshAudience,
						issuer: memoryIssuerUrl,
					});
					const { aud, exp, iat, iss, sub, ...claims } = payload;
					return sub === undefined
						? undefined
						: await tokensFromClaims(claims, sub);
				} catch {
					return undefined;
				}
			},
		},
		jwks,
	};
};

const oidcIssuerCreate = async (
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
 * routes, middleware and `authnMemoryTokenCreate` need. Throws on a secret under 32 bytes, a
 * URL scheme other than https:// or memory://, or an unreachable provider.
 */
export const authnCreate = async (options: AuthnOptions): Promise<Authn> => {
	issuerUrlCheck(options.issuerUrl);
	const cookieKey = authnCookieKey(options.secret);
	if (options.issuerUrl === memoryIssuerUrl) {
		const { issuer, jwks } = await memoryIssuerCreate(options);
		return {
			clientId: options.clientId,
			cookieKey,
			issuer,
			verify: verifyCreate(options, jwks, memoryIssuerUrl),
		};
	}
	const { issuer, issuerId, jwks } = await oidcIssuerCreate(options);
	return {
		clientId: options.clientId,
		cookieKey,
		issuer,
		verify: verifyCreate(options, jwks, issuerId),
	};
};

/** Signs an access token for `actor` with the memory issuer, for integration tests' bearer calls. */
export const authnMemoryTokenCreate = async (
	authn: Authn,
	actor: Actor,
): Promise<string> => {
	if (authn.issuer.kind !== "memory") {
		throw new TypeError(
			"authnMemoryTokenCreate works only with issuerUrl memory://",
		);
	}
	return (await authn.issuer.tokensCreate(actor)).accessToken;
};
