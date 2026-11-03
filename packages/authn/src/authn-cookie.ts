import { hkdfSync } from "node:crypto";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { EncryptJWT, jwtDecrypt } from "jose";

export const authnCookieNames = {
	access: "__Host-authn",
	flow: "__Secure-authn-flow",
	refresh: "__Secure-authn-refresh",
} as const;

type AuthnCookieName = keyof typeof authnCookieNames;

const sessionMaxAgeSeconds = 30 * 24 * 60 * 60;
const flowMaxAgeSeconds = 10 * 60;

// Paths and lifetimes per cookie (spec 4.10). Every cookie is HttpOnly, Secure and SameSite=Lax.
const cookieOptions: Record<AuthnCookieName, { maxAge: number; path: string }> =
	{
		access: { maxAge: sessionMaxAgeSeconds, path: "/" },
		flow: { maxAge: flowMaxAgeSeconds, path: "/auth/callback" },
		refresh: { maxAge: sessionMaxAgeSeconds, path: "/auth" },
	};

const cookieFlags = { httpOnly: true, sameSite: "Lax", secure: true } as const;

/** Decodes the base64url `secret`, refuses fewer than 32 bytes, and derives the cookie encryption key. */
export const authnCookieKey = (secret: string): Uint8Array => {
	const bytes = /^[A-Za-z0-9_-]+$/.test(secret)
		? Buffer.from(secret, "base64url")
		: Buffer.alloc(0);
	if (bytes.length < 32) {
		throw new TypeError(
			"authnCreate: secret must be base64url and decode to at least 32 bytes",
		);
	}
	return new Uint8Array(
		hkdfSync("sha256", bytes, "", "baseline-authn cookie", 32),
	);
};

/** Encrypts `value` into the named cookie. The cookie's name is bound into the ciphertext. */
export const authnCookieSet = async (
	c: Context,
	key: Uint8Array,
	name: AuthnCookieName,
	value: string,
): Promise<void> => {
	const options = cookieOptions[name];
	const sealed = await new EncryptJWT({ v: value })
		.setProtectedHeader({ alg: "dir", enc: "A256GCM" })
		.setAudience(name)
		.setExpirationTime(`${options.maxAge}s`)
		.encrypt(key);
	setCookie(c, authnCookieNames[name], sealed, { ...options, ...cookieFlags });
};

/**
 * Decrypts the named cookie: `undefined` when it is absent, `"invalid"` when it does not decrypt
 * with this secret, has expired, or belongs to another cookie name.
 */
export const authnCookieGet = async (
	c: Context,
	key: Uint8Array,
	name: AuthnCookieName,
): Promise<string | "invalid" | undefined> => {
	const sealed = getCookie(c, authnCookieNames[name]);
	if (sealed === undefined) return undefined;
	try {
		const { payload } = await jwtDecrypt(sealed, key, { audience: name });
		return typeof payload.v === "string" ? payload.v : "invalid";
	} catch {
		return "invalid";
	}
};

export const authnCookieClear = (c: Context, name: AuthnCookieName): void => {
	deleteCookie(c, authnCookieNames[name], {
		...cookieFlags,
		path: cookieOptions[name].path,
	});
};
