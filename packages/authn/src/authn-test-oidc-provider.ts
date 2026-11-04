import { createHash, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { exportJWK, generateKeyPair, type JWTPayload, SignJWT } from "jose";

export const idpOrigin = "https://idp.test";

type Grant = { challenge: string; nonce: string; sub: string; scope: string };

export type FakeProvider = {
	/** An access token as the provider would issue it, for bearer calls. */
	accessToken: (sub?: string) => Promise<string>;
	app: Hono;
	/** What the user's browser would get back from the authorize page: a code for this request. */
	authorize: (authorizeUrl: string, sub?: string) => string;
	revoked: string[];
	options: {
		accessAudience: string;
		down: boolean;
		jwksFails: boolean;
		noRefreshToken: boolean;
		revokeFails: boolean;
		rotate: boolean;
	};
	refreshTokens: Set<string>;
};

/** `fetch` for the stub: rejects like a network failure while `down`. */

/** A minimal OIDC provider: discovery, JWKS, authorization code with PKCE, refresh, revocation, end session. */
export const fakeProviderCreate = async (
	clientId: string,
): Promise<FakeProvider> => {
	const { privateKey, publicKey } = await generateKeyPair("RS256");
	const jwk = { ...(await exportJWK(publicKey)), alg: "RS256", kid: "k1" };
	const grants = new Map<string, Grant>();
	const refreshTokens = new Set<string>();
	const revoked: string[] = [];
	const options = {
		accessAudience: "api",
		down: false,
		jwksFails: false,
		noRefreshToken: false,
		revokeFails: false,
		rotate: true,
	};
	const sign = (claims: JWTPayload, audience: string, sub: string) =>
		new SignJWT(claims)
			.setProtectedHeader({ alg: "RS256", kid: "k1" })
			.setIssuer(idpOrigin)
			.setSubject(sub)
			.setAudience(audience)
			.setIssuedAt()
			.setExpirationTime("10m")
			.sign(privateKey);
	const tokens = async (
		grant: Omit<Grant, "challenge">,
		withIdToken: boolean,
	) => {
		const refreshToken = randomUUID();
		refreshTokens.add(refreshToken);
		return {
			access_token: await sign(
				{ scope: grant.scope },
				options.accessAudience,
				grant.sub,
			),
			expires_in: 600,
			refresh_token: refreshToken,
			token_type: "Bearer",
			...(withIdToken
				? { id_token: await sign({ nonce: grant.nonce }, clientId, grant.sub) }
				: {}),
		};
	};

	const app = new Hono();
	app.get("/.well-known/openid-configuration", (c) =>
		c.json({
			authorization_endpoint: `${idpOrigin}/authorize`,
			end_session_endpoint: `${idpOrigin}/logout`,
			issuer: idpOrigin,
			jwks_uri: `${idpOrigin}/jwks`,
			revocation_endpoint: `${idpOrigin}/revoke`,
			token_endpoint: `${idpOrigin}/token`,
		}),
	);
	app.get("/jwks", (c) =>
		options.jwksFails
			? c.json({ error: "unavailable" }, 503)
			: c.json({ keys: [jwk] }),
	);
	app.post("/token", async (c) => {
		const body = await c.req.parseBody();
		if (body.grant_type === "authorization_code") {
			const grant = grants.get(String(body.code));
			grants.delete(String(body.code));
			const challenge = createHash("sha256")
				.update(String(body.code_verifier))
				.digest("base64url");
			if (grant === undefined || grant.challenge !== challenge) {
				return c.json({ error: "invalid_grant" }, 400);
			}
			const issued = await tokens(grant, true);
			if (!options.noRefreshToken) return c.json(issued);
			refreshTokens.delete(issued.refresh_token);
			const { refresh_token: _, ...withoutRefresh } = issued;
			return c.json(withoutRefresh);
		}
		if (body.grant_type === "refresh_token") {
			const token = String(body.refresh_token);
			if (!refreshTokens.has(token))
				return c.json({ error: "invalid_grant" }, 400);
			const fresh = await tokens(
				{ nonce: "", scope: "foo:read", sub: "user-1" },
				false,
			);
			if (!options.rotate) {
				refreshTokens.delete(fresh.refresh_token);
				const { refresh_token: _, ...rest } = fresh;
				return c.json(rest);
			}
			refreshTokens.delete(token);
			return c.json(fresh);
		}
		return c.json({ error: "unsupported_grant_type" }, 400);
	});
	app.post("/revoke", async (c) => {
		if (options.revokeFails) return c.json({ error: "server_error" }, 500);
		const body = await c.req.parseBody();
		revoked.push(String(body.token));
		refreshTokens.delete(String(body.token));
		return c.body(null, 200);
	});

	return {
		accessToken: (sub = "user-1") =>
			sign({ scope: "foo:read" }, options.accessAudience, sub),
		app,
		authorize: (authorizeUrl, sub = "user-1") => {
			const params = new URL(authorizeUrl).searchParams;
			const code = randomUUID();
			grants.set(code, {
				challenge: params.get("code_challenge") ?? "",
				nonce: params.get("nonce") ?? "",
				scope: "foo:read",
				sub,
			});
			return code;
		},
		options,
		refreshTokens,
		revoked,
	};
};
