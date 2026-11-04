import { createDecipheriv, hkdfSync } from "node:crypto";

// The access cookie is a JWE (dir, A256GCM) of the provider's access token, keyed from
// AUTHN_SECRET the way @n8io/baseline-authn derives it.
const accessTokenFromCookie = (sealed: string): string => {
	const secret = process.env.AUTHN_SECRET;
	if (secret === undefined) throw new Error("AUTHN_SECRET is not loaded");
	const key = hkdfSync(
		"sha256",
		Buffer.from(secret, "base64url"),
		"",
		"baseline-authn cookie",
		32,
	);
	const [header = "", , iv = "", ciphertext = "", tag = ""] = sealed.split(".");
	const decipher = createDecipheriv(
		"aes-256-gcm",
		Buffer.from(key),
		Buffer.from(iv, "base64url"),
	);
	decipher.setAAD(Buffer.from(header, "ascii"));
	decipher.setAuthTag(Buffer.from(tag, "base64url"));
	const payload = Buffer.concat([
		decipher.update(Buffer.from(ciphertext, "base64url")),
		decipher.final(),
	]).toString("utf8");
	return (JSON.parse(payload) as { v: string }).v;
};

export type SignedIn = {
	/** The access cookie's sealed value, to search telemetry for. */
	accessCookie: string;
	/** `Authorization` header value for /api/v1. */
	authorization: string;
	/** `Cookie` header value for pages and live streams. */
	cookie: string;
	/** The access token inside the cookie (signed by this server's memory issuer). */
	token: string;
};

/** Signs in through the memory issuer's form; each server instance signs its own tokens. */
export const integrationSignIn = async (
	url: string,
	who: "admin" | "user" = "admin",
): Promise<SignedIn> => {
	const res = await fetch(`${url}/auth/sign-in`, {
		body: new URLSearchParams({ who }),
		method: "POST",
		redirect: "manual",
	});
	await res.body?.cancel();
	const pairs = res.headers.getSetCookie().map((line) => line.split(";")[0]);
	const access = pairs.find((pair) => pair?.startsWith("__Host-authn="));
	if (access === undefined) throw new Error(`sign-in failed: ${res.status}`);
	const accessCookie = access.slice("__Host-authn=".length);
	const token = accessTokenFromCookie(accessCookie);
	return {
		accessCookie,
		authorization: `Bearer ${token}`,
		cookie: pairs.join("; "),
		token,
	};
};
