import {
	createRemoteJWKSet,
	type JWTVerifyGetKey,
	customFetch as joseCustomFetch,
} from "jose";
import { customFetch as clientCustomFetch, discovery } from "openid-client";
import type { AuthnOidcIssuer, AuthnOptions } from "./authn-types.ts";

export const authnOidcIssuerCreate = async (
	options: AuthnOptions,
): Promise<{
	issuer: AuthnOidcIssuer;
	issuerId: string;
	jwks: JWTVerifyGetKey;
}> => {
	const fetchOption = options.fetch ?? null;
	const config = await discovery(
		new URL(options.issuerUrl),
		options.clientId,
		options.clientSecret,
		undefined,
		fetchOption === null
			? undefined
			: {
					[clientCustomFetch]: (url, init) =>
						fetchOption(url, init as RequestInit),
				},
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
		jwks: createRemoteJWKSet(
			new URL(metadata.jwks_uri),
			fetchOption === null ? undefined : { [joseCustomFetch]: fetchOption },
		),
	};
};
