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

const signedInMaxAgeSeconds = 30 * 24 * 60 * 60;
const flowMaxAgeSeconds = 10 * 60;

// Paths and lifetimes per cookie. Every cookie is HttpOnly, Secure and SameSite=Lax.
const cookieOptions: Record<AuthnCookieName, { maxAge: number; path: string }> =
	{
		access: { maxAge: signedInMaxAgeSeconds, path: "/" },
		flow: { maxAge: flowMaxAgeSeconds, path: "/auth/callback" },
		refresh: { maxAge: signedInMaxAgeSeconds, path: "/auth" },
	};

const cookieFlags = { httpOnly: true, sameSite: "Lax", secure: true } as const;

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

/** The cookie encryption key derived from `secret`. */
export const authnCookieKey = (secret: string): Uint8Array =>
	authnSecretKeyDerive({ info: "baseline-authn cookie", secret });

/** Encrypts `value` into the named cookie. The cookie's name is bound into the ciphertext. */
export const authnCookieSet = async ({
	c,
	key,
	name,
	value,
}: {
	c: Context;
	key: Uint8Array;
	name: AuthnCookieName;
	value: string;
}): Promise<void> => {
	const options = cookieOptions[name];
	const sealed = await new EncryptJWT({ v: value })
		.setProtectedHeader({ alg: "dir", enc: "A256GCM" })
		.setAudience(name)
		.setExpirationTime(`${options.maxAge}s`)
		.encrypt(key);
	setCookie(c, authnCookieNames[name], sealed, { ...options, ...cookieFlags });
};

/**
 * Decrypts a cookie's sealed value: `"invalid"` when it does not decrypt with this secret, has
 * expired, or belongs to another cookie name.
 */
export const authnCookieOpen = async ({
	key,
	name,
	sealed,
}: {
	key: Uint8Array;
	name: AuthnCookieName;
	sealed: string;
}): Promise<string | "invalid"> => {
	try {
		const { payload } = await jwtDecrypt(sealed, key, { audience: name });
		return typeof payload.v === "string" ? payload.v : "invalid";
	} catch {
		return "invalid";
	}
};

/** Decrypts the named cookie: `undefined` when it is absent, else what `authnCookieOpen` returns. */
export const authnCookieGet = async ({
	c,
	key,
	name,
}: {
	c: Context;
	key: Uint8Array;
	name: AuthnCookieName;
}): Promise<string | "invalid" | undefined> => {
	const sealed = getCookie(c, authnCookieNames[name]);
	return sealed === undefined
		? undefined
		: authnCookieOpen({ key, name, sealed });
};

export const authnCookieClear = (c: Context, name: AuthnCookieName): void => {
	deleteCookie(c, authnCookieNames[name], {
		...cookieFlags,
		path: cookieOptions[name].path,
	});
};
