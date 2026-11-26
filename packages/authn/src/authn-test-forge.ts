import { EncryptJWT, SignJWT } from "jose";
import { authnCookieKey, authnCookieNames } from "./authn-cookie.ts";
import { authnSecretKeyDerive } from "./authn-secret-key.ts";
import { authnTestSecret } from "./authn-test-helpers.ts";
import type { Actor } from "./index.ts";

// What the tests below need so that "time passes" is a token that already lapsed, never a clock
// the code under test reads: they sign what the memory issuer of `authnTestMemoryOptions` would
// have signed, with an expiry of the caller's choosing.

/** Signs an access token as the memory issuer does, but expiring `expiresInSeconds` from now (negative: already expired). */
export const authnTestTokenForge = async ({
	actor,
	expiresInSeconds,
}: {
	actor: Actor;
	expiresInSeconds: number;
}): Promise<string> => {
	const issuedAt = Math.floor(Date.now() / 1000);
	return new SignJWT({
		client_id: "dev",
		scope: actor.scopes.join(" "),
		...(actor.kind === "client" ? { gty: "client-credentials" } : {}),
	})
		.setProtectedHeader({ alg: "HS256" })
		.setIssuer("memory://")
		.setSubject(actor.id)
		.setAudience("dev")
		.setIssuedAt(issuedAt - 1)
		.setExpirationTime(issuedAt + expiresInSeconds)
		.sign(
			authnSecretKeyDerive({
				info: "baseline-authn-memory-issuer",
				secret: authnTestSecret,
			}),
		);
};

/** A `Cookie` header value whose access cookie holds a token expiring `expiresInSeconds` from now; any other cookie in `keep` (a `Cookie` header value) stays. */
export const authnTestCookieForge = async ({
	actor,
	expiresInSeconds,
	keep = "",
}: {
	actor: Actor;
	expiresInSeconds: number;
	keep?: string;
}): Promise<string> => {
	const sealed = await new EncryptJWT({
		v: await authnTestTokenForge({ actor, expiresInSeconds }),
	})
		.setProtectedHeader({ alg: "dir", enc: "A256GCM" })
		.setAudience("access")
		.setExpirationTime("30d")
		.encrypt(authnCookieKey(authnTestSecret));
	const others = keep
		.split("; ")
		.filter(
			(pair) => pair !== "" && !pair.startsWith(`${authnCookieNames.access}=`),
		);
	return [`${authnCookieNames.access}=${sealed}`, ...others].join("; ");
};
