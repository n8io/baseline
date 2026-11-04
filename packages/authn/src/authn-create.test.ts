import { describe, expect, it } from "vitest";
import { memoryOptions } from "./authn-test-helpers.ts";
import { type Actor, authnCreate } from "./index.ts";

const verify = async (
	options: Partial<typeof memoryOptions>,
	actor: Actor = { id: "dev-user", kind: "user", scopes: [] },
) => {
	const authn = await authnCreate({ ...memoryOptions, ...options });
	if (authn.issuer.kind !== "memory") throw new Error("memory issuer expected");
	const { accessToken } = await authn.issuer.tokensCreate(actor);
	return authn.verify(accessToken);
};

describe("authnCreate", () => {
	it("refuses a secret that decodes to fewer than 32 bytes", async () => {
		await expect(
			authnCreate({
				...memoryOptions,
				secret: Buffer.alloc(31).toString("base64url"),
			}),
		).rejects.toThrow(/at least 32 bytes/);
	});

	it("refuses a secret that is not base64url", async () => {
		await expect(
			authnCreate({ ...memoryOptions, secret: `${"a".repeat(60)}+/=` }),
		).rejects.toThrow(/base64url/);
	});

	it("accepts a 32-byte base64url secret", async () => {
		const authn = await authnCreate(memoryOptions);

		expect(authn.issuer.kind).toBe("memory");
	});

	it.each(["http://idp.test", "postgres://idp.test", "idp.test"])(
		"refuses the issuer URL %s, naming the valid schemes",
		async (issuerUrl) => {
			await expect(
				authnCreate({ ...memoryOptions, issuerUrl }),
			).rejects.toThrow("issuerUrl must start with https:// or be memory://");
		},
	);
});

describe("the verifier", () => {
	it("accepts a memory token and returns its actor and expiry", async () => {
		const verified = await verify({});

		expect(verified).toMatchObject({
			actor: { id: "dev-user", kind: "user", scopes: [] },
			status: "valid",
		});
	});

	it("checks the audience", async () => {
		const authn = await authnCreate(memoryOptions);
		const other = await authnCreate({ ...memoryOptions, audience: "other" });
		if (other.issuer.kind !== "memory")
			throw new Error("memory issuer expected");
		const { accessToken } = await other.issuer.tokensCreate({
			id: "dev-user",
			kind: "user",
			scopes: [],
		});

		expect(await authn.verify(accessToken)).toStrictEqual({
			status: "invalid",
		});
	});

	it("checks client_id instead of aud when audienceClaim is client_id", async () => {
		expect(
			await verify({ audienceClaim: "client_id", audience: "dev" }),
		).toMatchObject({ status: "valid" });
		expect(
			await verify({
				audienceClaim: "client_id",
				audience: "dev",
				clientId: "other",
			}),
		).toStrictEqual({ status: "invalid" });
	});

	it("treats claims actorFromClaims cannot map to an Actor as invalid", async () => {
		expect(
			await verify({
				actorFromClaims: () => ({ id: "", kind: "user", scopes: [] }),
			}),
		).toStrictEqual({ status: "invalid" });
	});

	it("treats claims that make actorFromClaims throw as invalid, not a 500", async () => {
		expect(
			await verify({
				actorFromClaims: () => {
					throw new TypeError("no sub");
				},
			}),
		).toStrictEqual({ status: "invalid" });
	});

	it("never accepts a memory refresh token as an access token", async () => {
		const authn = await authnCreate(memoryOptions);
		if (authn.issuer.kind !== "memory")
			throw new Error("memory issuer expected");
		const { refreshToken } = await authn.issuer.tokensCreate({
			id: "dev-user",
			kind: "user",
			scopes: [],
		});

		expect(await authn.verify(refreshToken ?? "")).toStrictEqual({
			status: "invalid",
		});
	});
});
