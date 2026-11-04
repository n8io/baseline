import type { JWTPayload } from "jose";
import type { Actor, AuthnOptions } from "./index.ts";

export const appOrigin: string = "https://app.test";
export const secret: string = Buffer.alloc(32, 7).toString("base64url");

// The template's default mapping: `sub`, space-separated `scope`, `gty` for machines.
export const actorFromClaims = (claims: JWTPayload): Actor => ({
	id: String(claims.sub),
	kind: claims.gty === "client-credentials" ? "client" : "user",
	scopes:
		typeof claims.scope === "string" && claims.scope !== ""
			? claims.scope.split(" ")
			: [],
});

export const memoryOptions: AuthnOptions = {
	actorFromClaims,
	audience: "dev",
	clientId: "dev",
	clientSecret: "dev",
	issuerUrl: "memory://",
	memoryAdminScopes: ["foo:delete", "foo:update"],
	secret,
};

/** A cookie jar for `app.request`: keeps what Set-Cookie sends, by name. */
export type CookieJar = {
	get: (name: string) => string | undefined;
	header: () => string;
	store: (res: Response) => void;
};

export const cookieJar = (): CookieJar => {
	const cookies = new Map<string, string>();
	return {
		get: (name: string): string | undefined => cookies.get(name),
		header: (): string =>
			[...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
		store: (res: Response): void => {
			for (const line of res.headers.getSetCookie()) {
				const [pair = ""] = line.split(";");
				const index = pair.indexOf("=");
				const name = pair.slice(0, index);
				const value = pair.slice(index + 1);
				if (value === "" || /max-age=0/i.test(line)) cookies.delete(name);
				else cookies.set(name, value);
			}
		},
	};
};

/** The Set-Cookie line for `name`, or undefined. */
export const authnSetCookieLine = (
	res: Response,
	name: string,
): string | undefined =>
	res.headers.getSetCookie().find((line) => line.startsWith(`${name}=`));

export type PageBody = { actor: Actor | null; expiresAt: number | null };

/** The test page route's JSON: what `authnMiddleware` set. */
export const pageBody = async (res: Response): Promise<PageBody> =>
	(await res.json()) as PageBody;
