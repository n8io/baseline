import { hkdfSync } from "node:crypto";

/**
 * Decodes the base64url `secret`, refuses fewer than 32 bytes, and derives a 32-byte key from it
 * for one use, named by `info`.
 */
export const authnSecretKeyDerive = ({
	info,
	secret,
}: {
	info: string;
	secret: string;
}): Uint8Array => {
	const bytes = /^[A-Za-z0-9_-]+$/.test(secret)
		? Buffer.from(secret, "base64url")
		: Buffer.alloc(0);
	if (bytes.length < 32) {
		throw new TypeError(
			"authnCreate: secret must be base64url and decode to at least 32 bytes; make one with `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`",
		);
	}
	return new Uint8Array(hkdfSync("sha256", bytes, "", info, 32));
};
