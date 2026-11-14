import { logger } from "@n8io/baseline-logger";
import {
	createClient,
	type RedisClientOptions as NodeRedisClientOptions,
	type RedisClientType,
} from "redis";

/**
 * A connected node-redis client, for `cacheStoreRedisCreate`, `liveHubRedisCreate` and a Project's
 * own adapters. Close it with `close()`; `await using` calls `close()` when its block ends.
 */
export type RedisClient = RedisClientType & AsyncDisposable;

// The settings this Package decides, and where each is set instead.
const redisVendorOwnedKeys = {
	commandOptions: "this Package (1 s to send a command)",
	database: "url (redis://host/<database>)",
	password: "url (redis://user:password@host)",
	url: "url",
	username: "url (redis://user:password@host)",
} as const;
const redisVendorOwnedSocketKeys = {
	connectTimeout: "this Package (3 s)",
	host: "url",
	path: "url",
	port: "url",
	reconnectStrategy: "this Package (fail at startup, then retry for good)",
	tls: "url (rediss:// for TLS)",
} as const;

const redisConnectTimeoutMs = 3_000;

/**
 * node-redis's own client settings, passed through as they are: `socket.ca`, `name`, `keyPrefix`
 * and the like. Outside this Package's contract: nothing here is tested, and moving off
 * node-redis deletes it. The keys the URL and this Package set are refused, and the ones that would
 * change the client's type are left out.
 */
export type RedisClientVendorOptions = Omit<
	NodeRedisClientOptions,
	| keyof typeof redisVendorOwnedKeys
	| "functions"
	| "modules"
	| "RESP"
	| "scripts"
	| "typeMapping"
>;

/** What `redisClientCreate` takes; not node-redis's own `RedisClientOptions`, which `vendor` carries. */
export type RedisClientOptions = {
	/** redis:// or rediss:// (TLS). It may carry a user, a password and a database number. */
	url: string;
	/** Settings only node-redis has. */
	vendor?: RedisClientVendorOptions | null;
};

// Throws on a vendor setting that the URL or this Package already decides.
const redisVendorAssert = ({
	url,
	vendor,
}: {
	url: string;
	vendor: RedisClientVendorOptions;
}): void => {
	const { password, username } = new URL(url);
	if ("credentialsProvider" in vendor && (password || username)) {
		throw new TypeError(
			"vendor.credentialsProvider is not allowed with a user or password in url: node-redis lets the URL win; set credentials in one place",
		);
	}
	const owned: [object, string, Record<string, string>][] = [
		[vendor, "vendor", redisVendorOwnedKeys],
		[vendor.socket ?? {}, "vendor.socket", redisVendorOwnedSocketKeys],
	];
	for (const [settings, path, keys] of owned) {
		for (const [key, owner] of Object.entries(keys)) {
			if (key in settings) {
				throw new TypeError(
					`${path}.${key} is not allowed: it is set by ${owner}`,
				);
			}
		}
	}
};

/**
 * Opens the one Redis connection a process shares, and resolves once it is connected, so an
 * unreachable Redis stops startup within the 3 s connect timeout instead of retrying. After that a
 * dropped connection reconnects every min(retries × 100 ms, 2 s), for as long as it takes. One URL
 * fits a highly available Redis whose endpoint follows the primary (a managed one, or a proxy in
 * front of Sentinel); Sentinel or Cluster addressed directly is not supported.
 */
export const redisClientCreate = async ({
	url,
	vendor,
}: RedisClientOptions): Promise<RedisClient> => {
	const settings = vendor ?? {};
	redisVendorAssert({ url, vendor: settings });
	let connected = false;
	const redisClient = createClient({
		...settings,
		// node-redis drops this timer once a command is sent, so it only limits the wait to send.
		commandOptions: { timeout: 1_000 },
		socket: {
			...settings.socket,
			connectTimeout: redisConnectTimeoutMs,
			reconnectStrategy: (retries: number) =>
				connected ? Math.min(retries * 100, 2_000) : false,
		},
		url,
	});
	// node-redis exits the process on an unlistened error event. Never log the URL: it may carry
	// a password.
	redisClient.on("error", (err: unknown) => {
		logger.error({ err }, "Redis client error");
	});
	// connectTimeout bounds only the TCP connect; this also bounds a server that accepts and never
	// answers the handshake.
	let timer: NodeJS.Timeout | undefined;
	try {
		await Promise.race([
			redisClient.connect(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					reject(
						new DOMException(
							`Redis not ready within ${redisConnectTimeoutMs} ms`,
							"TimeoutError",
						),
					);
				}, redisConnectTimeoutMs);
			}),
		]);
	} catch (err) {
		// A refused connect has closed the client already.
		if (redisClient.isOpen) redisClient.destroy();
		throw err;
	} finally {
		clearTimeout(timer);
	}
	connected = true;
	return Object.assign(redisClient, {
		[Symbol.asyncDispose]: () => redisClient.close(),
	});
};
