import { authnCookieKey } from "./authn-cookie.ts";
import {
	authnMemoryIssuerCreate,
	memoryAlgorithm,
	memoryIssuerUrl,
} from "./authn-memory-issuer.ts";
import { authnOidcIssuerCreate } from "./authn-oidc-issuer.ts";
import { authnFromState } from "./authn-state.ts";
import type { Authn, AuthnOptions } from "./authn-types.ts";
import { authnVerifyCreate } from "./authn-verify.ts";

export { authnState } from "./authn-state.ts";
export type {
	Authn,
	AuthnClaims,
	AuthnMemoryClient,
	AuthnMemoryUser,
	AuthnOptions,
	AuthnState,
	AuthnVerified,
} from "./authn-types.ts";

const authnAudienceClaimCheck = (options: AuthnOptions): void => {
	const claim = options.audienceClaim;
	if (claim == null || claim === "aud" || claim === "client_id") return;
	throw new TypeError(
		`authnCreate: audienceClaim must be "aud" or "client_id", found "${claim}"`,
	);
};

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

/**
 * Discovers the provider (or starts the memory issuer for `memory://`) and returns what the
 * routes, middleware and `authnTestTokenCreate` need. Throws on a secret under 32 bytes, a
 * URL scheme other than https:// or memory://, memory:// without `memoryIssuerAllowed`, an id
 * listed twice in `memoryUsers` or `memoryClients`, or an unreachable provider.
 */
export const authnCreate = async (options: AuthnOptions): Promise<Authn> => {
	authnIssuerUrlCheck(options);
	authnAudienceClaimCheck(options);
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
