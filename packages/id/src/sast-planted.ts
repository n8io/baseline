import { createDecipheriv, hkdfSync } from "node:crypto";
// Planted to prove the sast job fails; removed before merge.

// The access cookie is a JWE (dir, A256GCM) of the provider's access token, keyed from
// AUTHN_SECRET the way @n8io/baseline-authn derives it.
export const sastPlanted = (sealed: string): string => {
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
