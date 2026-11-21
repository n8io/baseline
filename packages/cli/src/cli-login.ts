// The stored login: a token from the Project's client-credentials grant, kept in the OS config
// directory with mode 600, one per URL (so one per environment), and sent only to the URL it
// came from.

import { fstatSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { text } from "node:stream/consumers";
import { sdkFetchCreate } from "@n8io/baseline-sdk";

type CliLogin = { expiresAt: string; token: string };

// The stored file: a login per URL. A missing or unreadable file, an older file's shape and an
// expired login read as none, so the next `login` writes a clean file.
const loginsRead = async (name: string): Promise<Record<string, CliLogin>> => {
	const stored: unknown = await readFile(cliLoginPath(name), "utf8")
		.then(JSON.parse)
		.catch(() => null);
	return Object.fromEntries(
		Object.entries(
			typeof stored === "object" && stored !== null ? stored : {},
		).filter(([, login]) => Date.parse(login?.expiresAt) > Date.now()),
	);
};

// The SDK's fetch, so the token request has the same timeouts; a POST is never retried.
const { sdkFetch } = sdkFetchCreate();

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
const cliLoginPath = (name: string): string =>
	join(configDirectory(), name, "login.json");

/** The stored token for `url`, unless it has expired or came from another URL. */
export const cliLoginTokenRead = async ({
	name,
	url,
}: {
	name: string;
	url: string;
}): Promise<string | undefined> => {
	const { token } = (await loginsRead(name))[url] ?? {};
	return typeof token === "string" ? token : undefined;
};

// The client secret: `<NAME>_CLIENT_SECRET`, else stdin from a shell pipe or a file, never a
// flag. The memory issuer needs none, so a terminal (or a parent's open socket) sends none.
const clientSecretRead = async (name: string): Promise<string | undefined> => {
	const fromEnv = process.env[`${cliEnvPrefix(name)}_CLIENT_SECRET`];
	if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
	const stdin = fstatSync(0);
	if (!stdin.isFIFO() && !stdin.isFile()) return undefined;
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
	const { hostname, protocol } = new URL(url);
	if (
		protocol !== "https:" &&
		!["127.0.0.1", "[::1]", "localhost"].includes(hostname)
	) {
		return {
			error: `login failed: ${url} is not https, so the client secret would travel in the clear`,
		};
	}
	const secret = await clientSecretRead(name);
	const sent = await sdkFetch<{ data: unknown; status: number }>(
		"/auth/token",
		{
			baseUrl: url,
			body: new URLSearchParams({
				client_id: clientId,
				grant_type: "client_credentials",
				...(secret === undefined ? {} : { client_secret: secret }),
				...(scopes == null ? {} : { scope: scopes.join(" ") }),
			}),
			// The Project's CSRF check refuses a form post without its Origin.
			headers: { origin: new URL(url).origin },
			method: "POST",
		},
	).catch((error: unknown) => ({ error }));
	if ("error" in sent) {
		const { error } = sent;
		const reason =
			error instanceof SyntaxError
				? "answered with a body that is not JSON"
				: `got no answer: ${error instanceof Error ? error.message : String(error)}${error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : ""}`;
		return { error: `login failed: POST ${url}/auth/token ${reason}` };
	}
	const body = (
		typeof sent.data === "object" && sent.data !== null ? sent.data : {}
	) as Record<string, unknown>;
	if (
		sent.status < 200 ||
		sent.status > 299 ||
		typeof body.access_token !== "string" ||
		typeof body.expires_in !== "number"
	) {
		return {
			error:
				`login failed: POST ${url}/auth/token answered ${sent.status} ${typeof body.error === "string" ? body.error : ""}`.trimEnd(),
		};
	}
	const logins = {
		...(await loginsRead(name)),
		[url]: {
			expiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString(),
			token: body.access_token,
		},
	};
	const path = cliLoginPath(name);
	await mkdir(join(path, ".."), { mode: 0o700, recursive: true });
	// A new file with mode 600, renamed over the old one, so the token is never in a file others
	// can read.
	await writeFile(`${path}.${process.pid}`, JSON.stringify(logins), {
		mode: 0o600,
	});
	await rename(`${path}.${process.pid}`, path);
	return { path };
};
