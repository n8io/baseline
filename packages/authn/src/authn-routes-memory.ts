import type { Context } from "hono";
import { z } from "zod";
import { authnReturnToSafe } from "./authn-return-to.ts";
import { authnRoutesTokensStore } from "./authn-routes-tokens.ts";
import type { AuthnMemoryIssuer, AuthnState } from "./authn-types.ts";

const MemorySignIn = z.object({
	returnTo: z.string().optional(),
	who: z.string(),
});

export const authnRoutesMemorySignIn = async ({
	authn,
	c,
	issuer,
}: {
	authn: AuthnState;
	c: Context;
	issuer: AuthnMemoryIssuer;
}): Promise<Response> => {
	const form = MemorySignIn.safeParse(await c.req.parseBody());
	const user =
		form.data && issuer.users.find((entry) => entry.id === form.data.who);
	if (form.data === undefined || user === undefined) return c.body(null, 400);
	const tokens = await issuer.tokensCreate({
		id: user.id,
		kind: "user",
		scopes: user.scopes,
	});
	if ((await authnRoutesTokensStore({ c, authn, tokens })) === undefined) {
		throw new TypeError(
			"authn: actorFromClaims rejected a memory issuer token",
		);
	}
	return c.redirect(authnReturnToSafe(form.data.returnTo), 302);
};

const TokenRequest = z.object({
	client_id: z.string(),
	grant_type: z.string(),
	scope: z.string().optional(),
});

const tokenError = (
	c: Context,
	error:
		| "invalid_client"
		| "invalid_request"
		| "invalid_scope"
		| "unsupported_grant_type",
): Response => c.json({ error }, error === "invalid_client" ? 401 : 400);

/**
 * `POST /auth/token`, the memory issuer's client-credentials grant: a form with
 * `grant_type=client_credentials`, `client_id` and an optional space-separated `scope`, which must
 * be a subset of the client's (default all of them). No client secret: development and test only.
 */
export const authnRoutesMemoryToken = async ({
	c,
	issuer,
}: {
	c: Context;
	issuer: AuthnMemoryIssuer;
}): Promise<Response> => {
	const form = TokenRequest.safeParse(await c.req.parseBody());
	if (form.data === undefined) return tokenError(c, "invalid_request");
	if (form.data.grant_type !== "client_credentials") {
		return tokenError(c, "unsupported_grant_type");
	}
	const client = issuer.clients.find(
		(entry) => entry.id === form.data.client_id,
	);
	if (client === undefined) return tokenError(c, "invalid_client");
	const scopes =
		form.data.scope === undefined
			? client.scopes
			: form.data.scope.split(" ").filter(Boolean);
	if (!scopes.every((scope) => client.scopes.includes(scope))) {
		return tokenError(c, "invalid_scope");
	}
	const { accessToken } = await issuer.tokensCreate({
		id: client.id,
		kind: "client",
		scopes,
	});
	return c.json({
		access_token: accessToken,
		expires_in: issuer.accessTtlSeconds,
		token_type: "Bearer",
	});
};
