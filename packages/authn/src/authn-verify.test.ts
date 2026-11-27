import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import type { AuthnOptions } from "./authn-types.ts";
import { authnVerifyCreate } from "./authn-verify.ts";

const key = new Uint8Array(32).fill(3);
const issuer = "https://idp.test";

const optionsCreate = (overrides: Partial<AuthnOptions> = {}): AuthnOptions =>
	({
		actorFromClaims: (claims) => ({
			id: String(claims["sub"]),
			kind: "user",
			scopes: [],
		}),
		audience: "api",
		clientId: "app",
		clientSecret: "secret",
		issuerUrl: issuer,
		secret: "unused",
		...overrides,
	}) as AuthnOptions;

const verifyCreate = (options: AuthnOptions) =>
	authnVerifyCreate({
		algorithms: ["HS256"],
		issuer,
		jwks: async () => key,
		options,
	});

const tokenSign = ({
	audience = "api",
	claims = {},
	expiresAt = Math.floor(Date.now() / 1000) + 600,
}: {
	audience?: string;
	claims?: Record<string, unknown>;
	expiresAt?: number | null;
} = {}) => {
	const jwt = new SignJWT(claims)
		.setProtectedHeader({ alg: "HS256" })
		.setIssuer(issuer)
		.setSubject("user-1")
		.setAudience(audience);
	return (expiresAt === null ? jwt : jwt.setExpirationTime(expiresAt)).sign(
		key,
	);
};

describe("authnVerifyCreate", () => {
	it("accepts a token for the audience, with its Actor and expiry", async () => {
		const expiresAt = Math.floor(Date.now() / 1000) + 600;
		const verified = await verifyCreate(optionsCreate())(
			await tokenSign({ expiresAt }),
		);

		expect(verified).toStrictEqual({
			actor: { id: "user-1", kind: "user", scopes: [] },
			expiresAt: expiresAt * 1000,
			status: "valid",
		});
	});

	it("reports an expired token as expired", async () => {
		const verified = await verifyCreate(optionsCreate())(
			await tokenSign({ expiresAt: Math.floor(Date.now() / 1000) - 60 }),
		);

		expect(verified.status).toBe("expired");
	});

	it("refuses a token without an expiry", async () => {
		const verified = await verifyCreate(optionsCreate())(
			await tokenSign({ expiresAt: null }),
		);

		expect(verified.status).toBe("invalid");
	});

	it("refuses a token for another audience", async () => {
		const verified = await verifyCreate(optionsCreate())(
			await tokenSign({ audience: "someone-else" }),
		);

		expect(verified.status).toBe("invalid");
	});

	it("refuses a token whose claims do not map to an Actor, however the mapping fails", async () => {
		const thrown = await verifyCreate(
			optionsCreate({
				actorFromClaims: () => {
					throw new Error("no actor in these claims");
				},
			}),
		)(await tokenSign());
		const malformed = await verifyCreate(
			optionsCreate({ actorFromClaims: () => ({}) as never }),
		)(await tokenSign());

		expect(thrown.status).toBe("invalid");
		expect(malformed.status).toBe("invalid");
	});

	describe("with audienceClaim client_id", () => {
		const options = optionsCreate({ audienceClaim: "client_id" });

		it("checks client_id, not aud", async () => {
			const verified = await verifyCreate(options)(
				await tokenSign({ audience: "whatever", claims: { client_id: "api" } }),
			);

			expect(verified.status).toBe("valid");
		});

		it("refuses another client_id even when aud matches", async () => {
			const verified = await verifyCreate(options)(
				await tokenSign({ audience: "api", claims: { client_id: "other" } }),
			);

			expect(verified.status).toBe("invalid");
		});
	});
});
