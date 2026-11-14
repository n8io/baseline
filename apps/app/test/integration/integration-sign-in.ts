import {
	type AuthnTestSignedIn,
	authnTestSignIn,
} from "@n8io/baseline-authn/testing";

export type SignedIn = AuthnTestSignedIn;

/** Signs in through the memory issuer's form as the Server's Dev admin or Dev user. */
export const integrationSignIn = async (
	url: string,
	who: "admin" | "user" = "admin",
): Promise<SignedIn> => {
	const secret = process.env.AUTHN_SECRET;
	if (secret === undefined) throw new Error("AUTHN_SECRET is not loaded");
	return authnTestSignIn({ secret, url, who: `dev-${who}` });
};
