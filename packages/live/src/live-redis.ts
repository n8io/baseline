import { logger } from "@n8io/baseline-logger";
import { type LiveHub, liveHubCreate } from "./live-hub.ts";

// The part of a connected node-redis client the hub uses.
type LiveRedisClient = {
	close(): Promise<unknown>;
	connect(): Promise<unknown>;
	destroy(): void;
	duplicate(): LiveRedisClient;
	on(event: "error" | "ready", listener: (err: unknown) => void): unknown;
	publish(channel: string, message: string): Promise<unknown>;
	subscribe(
		channel: string,
		listener: (message: string) => void,
	): Promise<unknown>;
	unsubscribe(
		channel: string,
		listener: (message: string) => void,
	): Promise<unknown>;
};

const liveConnectTimeoutMs = 3000;
const liveCommandTimeoutMs = 1000;

// Settles like `work`, or rejects with a TimeoutError once `ms` passes first.
const liveTimeLimit = async <T>({
	message,
	ms,
	work,
}: {
	message: string;
	ms: number;
	work: Promise<T>;
}): Promise<T> => {
	let timer: NodeJS.Timeout | undefined;
	const timedOut = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			reject(new DOMException(message, "TimeoutError"));
		}, ms);
	});
	try {
		return await Promise.race([work, timedOut]);
	} finally {
		clearTimeout(timer);
	}
};

// Publishes to Redis channel `live:<channel>`, so every instance's streams get
// the update. The subscriber connection, a duplicate of `redisClient`, opens
// with the first stream; a worker that only sends never opens it. Redis pub/sub
// does not replay, so each time that connection comes back every open stream
// is told to resync. Any connected node-redis client works.
export const liveHubRedisCreate = ({
	redisClient,
}: {
	redisClient: LiveRedisClient;
}): LiveHub => {
	let subscriber: Promise<LiveRedisClient> | undefined;
	let resync = (): void => {};

	const subscriberConnect = async (): Promise<LiveRedisClient> => {
		const connection: LiveRedisClient = redisClient.duplicate();
		// node-redis exits the process on an unlistened error event.
		connection.on("error", (err: unknown) => {
			logger.error({ err }, "Redis live subscriber error");
		});
		try {
			await liveTimeLimit({
				message: `Redis not reachable within ${liveConnectTimeoutMs} ms`,
				ms: liveConnectTimeoutMs,
				work: connection.connect(),
			});
		} catch (err) {
			connection.destroy();
			throw err;
		}
		// Listened for only now, so it fires on a reconnect. node-redis has resubscribed by then.
		connection.on("ready", () => {
			resync();
		});
		return connection;
	};

	const subscriberGet = (): Promise<LiveRedisClient> => {
		if (subscriber === undefined) {
			const connecting = subscriberConnect();
			subscriber = connecting;
			// The next stream tries again.
			connecting.catch(() => {
				if (subscriber === connecting) subscriber = undefined;
			});
		}
		return subscriber;
	};

	return liveHubCreate({
		close: async () => {
			const connection = await subscriber?.catch(() => undefined);
			await connection?.close();
		},
		resyncListen: (listener) => {
			resync = listener;
		},
		publish: async (channel, message) => {
			await liveTimeLimit({
				message: `Redis did not answer within ${liveCommandTimeoutMs} ms`,
				ms: liveCommandTimeoutMs,
				work: redisClient.publish(`live:${channel}`, message),
			});
		},
		subscribe: async (channel, deliver) => {
			const connection = await subscriberGet();
			try {
				await liveTimeLimit({
					message: `Redis did not answer within ${liveCommandTimeoutMs} ms`,
					ms: liveCommandTimeoutMs,
					work: connection.subscribe(`live:${channel}`, deliver),
				});
			} catch (err) {
				// A late SUBSCRIBE would deliver twice once the next stream retries.
				connection
					.unsubscribe(`live:${channel}`, deliver)
					.catch(() => undefined);
				throw err;
			}
		},
	});
};
