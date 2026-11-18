// The stored login: a token from the app's client-credentials grant, kept in the OS config
// directory with mode 600 and sent only to the URL it came from.

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { text } from "node:stream/consumers";

type CliLogin = { expiresAt: string; token: string; url: string };

/** `fantasy-golf` becomes `FANTASY_GOLF`, the prefix of the CLI's env vars. */
export const cliEnvPrefix = (name: string): string =>
	name
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.replace(/\W/g, "_")
		.toUpperCase();

const configDirectory = (): string => {
	const xdg = process.env.XDG_CONFIG_HOME;
	if (xdg !== undefined && xdg !== "") return xdg;
	if (process.platform === "win32") {
		return process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
	}
	if (process.platform === "darwin") {
		return join(homedir(), "Library", "Application Support");
	}
	return join(homedir(), ".config");
};

/** Where `<name> login` keeps its token. */
export const cliLoginPath = (name: string): string =>
	join(configDirectory(), name, "login.json");

/** The stored token for `url`, unless it has expired or came from another URL. */
export const cliLoginTokenRead = async ({
	name,
	url,
}: {
	name: string;
	url: string;
}): Promise<string | undefined> => {
	const stored: Partial<CliLogin> = await readFile(
		cliLoginPath(name),
		"utf8",
	).then(JSON.parse, () => ({}));
	return stored.url === url &&
		typeof stored.token === "string" &&
		Date.parse(stored.expiresAt ?? "") > Date.now()
		? stored.token
		: undefined;
};

// The client secret: `<NAME>_CLIENT_SECRET`, else piped stdin, never a flag. The memory issuer
// needs none, so a terminal with no pipe sends none.
const clientSecretRead = async (name: string): Promise<string | undefined> => {
	const fromEnv = process.env[`${cliEnvPrefix(name)}_CLIENT_SECRET`];
	if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
	if (process.stdin.isTTY) return undefined;
	const piped = (await text(process.stdin)).trim();
	return piped === "" ? undefined : piped;
};

/**
 * `POST <url>/auth/token` with `grant_type=client_credentials`, then stores the token. Returns
 * the stored file's path, or the reason it failed.
 */
export const cliLoginRun = async ({
	clientId,
	name,
	scopes,
	url,
}: {
	clientId: string;
	name: string;
	scopes?: string[] | null;
	url: string;
}): Promise<{ error: string } | { path: string }> => {
	const secret = await clientSecretRead(name);
	const res = await fetch(`${url}/auth/token`, {
		body: new URLSearchParams({
			client_id: clientId,
			grant_type: "client_credentials",
			...(secret === undefined ? {} : { client_secret: secret }),
			...(scopes == null ? {} : { scope: scopes.join(" ") }),
		}),
		// The app's CSRF check refuses a form post without its Origin.
		headers: { origin: new URL(url).origin },
		method: "POST",
	});
	const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
	if (
		!res.ok ||
		typeof body.access_token !== "string" ||
		typeof body.expires_in !== "number"
	) {
		return {
			error:
				`login failed: POST ${url}/auth/token answered ${res.status} ${typeof body.error === "string" ? body.error : ""}`.trimEnd(),
		};
	}
	const login: CliLogin = {
		expiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString(),
		token: body.access_token,
		url,
	};
	const path = cliLoginPath(name);
	await mkdir(join(path, ".."), { mode: 0o700, recursive: true });
	await writeFile(path, JSON.stringify(login), { mode: 0o600 });
	// writeFile's mode applies only to a new file; an older one keeps its mode without this.
	await chmod(path, 0o600);
	return { path };
};
