import { describe, expect, it } from "vitest";
import {
	actorFromClaims,
	authnMemoryClientsCreate,
	authnMemoryUsersCreate,
	authnProviderOptionsCreate,
} from "./authn.ts";

describe("actorFromClaims", () => {
	it("reads a user from sub and space-separated scope", () => {
		expect(
			actorFromClaims({
				client_id: "web",
				scope: "bar:read  bar:update",
				sub: "u1",
			}),
		).toEqual({ id: "u1", kind: "user", scopes: ["bar:read", "bar:update"] });
	});

	it("marks client-credentials tokens as clients", () => {
		expect(
			actorFromClaims({ gty: "client-credentials", sub: "svc@clients" }),
		).toEqual({
			id: "svc@clients",
			kind: "client",
			scopes: [],
		});
	});

	it.each([
		["client_id", { client_id: "svc" }],
		["azp", { azp: "svc" }],
	])("marks a token whose sub equals %s as a client", (_name, claims) => {
		expect(actorFromClaims({ ...claims, sub: "svc" }).kind).toBe("client");
	});

	it("accepts scope as an array and ignores other types", () => {
		expect(actorFromClaims({ scope: ["a", 1, "b"], sub: "u1" }).scopes).toEqual(
			["a", "b"],
		);
		expect(actorFromClaims({ scope: 42, sub: "u1" }).scopes).toEqual([]);
	});

	it.each([{}, { sub: "" }, { sub: 7 }])(
		"throws without a string sub: %j",
		(claims) => {
			expect(() => actorFromClaims(claims)).toThrow(
				"The token has no sub claim",
			);
		},
	);
});

describe("authnProviderOptionsCreate", () => {
	it("maps the AUTHN_* values", () => {
		expect(
			authnProviderOptionsCreate({
				AUTHN_AUDIENCE: "api",
				AUTHN_CLIENT_ID: "web",
				AUTHN_CLIENT_SECRET: "shh",
				AUTHN_ISSUER_URL: "https://issuer.example.com",
				AUTHN_SECRET: "key",
			}),
		).toEqual({
			audience: "api",
			audienceClaim: "aud",
			authorizeParams: {},
			clientId: "web",
			clientSecret: "shh",
			issuerUrl: "https://issuer.example.com",
			secret: "key",
		});
	});
});

describe("the dev users and client", () => {
	it("gives the admin and the client every scope and the user none", () => {
		const scopes = ["bar:read", "bar:update"];

		expect(authnMemoryUsersCreate(scopes)).toEqual([
			{ id: "dev-user", name: "Dev user", scopes: [] },
			{ id: "dev-admin", name: "Dev admin", scopes },
		]);
		expect(authnMemoryClientsCreate(scopes)).toEqual([
			{ id: "dev-client", scopes },
		]);
	});
});
