import { type JWTPayload, jwtVerify, SignJWT } from "jose";
import type { Actor } from "./actor.ts";
import { authnSecretKeyDerive } from "./authn-secret-key.ts";
import type {
	AuthnMemoryIssuer,
	AuthnMemoryUser,
	AuthnOptions,
	AuthnTokens,
} from "./authn-types.ts";

export const memoryIssuerUrl = "memory://";
export const memoryAlgorithm = "HS256";
const memoryAccessTtlSeconds = 15 * 60;
const memoryRefreshTtl = "30d";
const memoryRefreshAudience = "baseline-authn-memory-refresh";

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
	entries: readonly { id: string }[],
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
export const authnMemoryIssuerCreate = (
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
