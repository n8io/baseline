import { logger } from "@n8io/baseline-logger";
import { type Counter, metrics } from "@opentelemetry/api";

// What changed, never model data: the page reruns its loader to read it.
export type LiveUpdate = { type: string; id: string };

export type LiveHub = {
	// Best effort: resolves once the update is handed over, and also when it could not be (the
	// failure is logged and counted). It never rejects, so call it after commit with no catch.
	send(channel: string, update: LiveUpdate): Promise<void>;
	close(): Promise<void>;
	/** Calls close(), so `await using` closes the hub when its block ends. */
	[Symbol.asyncDispose](): Promise<void>;
};

export type LiveListener = (update: LiveUpdate) => void;

// What liveStreamCreate needs from a hub beyond its public send and close.
export type LiveHubStreams = {
	isClosed(): boolean;
	// Resolves once updates for (channel, id) reach `listener`; returns the unlisten. From
	// then until the unlisten, `resync` runs each time updates may have been lost.
	listen(input: {
		channel: string;
		id: string;
		listener: LiveListener;
		resync: () => void;
	}): Promise<() => void>;
	// Registers a stream's end, which close() calls and awaits; returns the unregister.
	track(end: () => Promise<void>): () => void;
};

// How a hub moves JSON messages between instances (Redis pub/sub, or in process).
export type LiveTransport = {
	publish(channel: string, message: string): Promise<void>;
	// Delivers every message later published to `channel`. Called once per channel.
	subscribe(channel: string, deliver: (message: string) => void): Promise<void>;
	close(): Promise<void>;
	// Takes what to call each time messages may have been lost, such as after a reconnect.
	// A transport that loses none leaves it out.
	resyncListen?(resync: () => void): void;
};

const liveWarnIntervalMs = 30_000;

let sendsFailed: Counter | undefined;

// Taken on first use, after the telemetry preload has registered the meter provider.
const liveSendsFailedCounter = (): Counter => {
	sendsFailed ??= metrics
		.getMeter("@n8io/baseline-live")
		.createCounter("baseline.live.sends_failed", {
			description: "Live updates the transport could not send",
			unit: "{update}",
		});
	return sendsFailed;
};

const liveHubStreamsByHub = new WeakMap<LiveHub, LiveHubStreams>();

export const liveHubStreams = (liveHub: LiveHub): LiveHubStreams => {
	const streams = liveHubStreamsByHub.get(liveHub);
	if (streams === undefined) {
		throw new TypeError(
			"liveHub must come from liveHubRedisCreate or liveHubMemoryCreate",
		);
	}
	return streams;
};

// Another deploy may publish; take only { type, id } strings and drop the rest.
const liveUpdateParse = (message: string): LiveUpdate | undefined => {
	try {
		const parsed: unknown = JSON.parse(message);
		if (typeof parsed !== "object" || parsed === null) return undefined;
		const { id, type } = parsed as Record<string, unknown>;
		return typeof type === "string" && typeof id === "string"
			? { id, type }
			: undefined;
	} catch {
		return undefined;
	}
};

// One hub per instance: sends through the transport and fans each received
// update out to this instance's streams for its (channel, id).
export const liveHubCreate = (transport: LiveTransport): LiveHub => {
	const listeners = new Map<string, Set<LiveListener>>();
	const subscriptions = new Map<string, Promise<void>>();
	const ends = new Set<() => Promise<void>>();
	const resyncs = new Set<() => void>();
	let closed = false;
	let warnedAt = Number.NEGATIVE_INFINITY;
	let unlogged = 0;

	transport.resyncListen?.(() => {
		for (const resync of resyncs) resync();
	});

	// Counts every failure and warns once per 30 s, so an outage is not one line per send.
	const sendFailed = (channel: string, err: unknown): void => {
		liveSendsFailedCounter().add(1, { "baseline.live.channel": channel });
		if (Date.now() - warnedAt < liveWarnIntervalMs) {
			unlogged += 1;
			return;
		}
		logger.warn({ channel, err, unlogged }, "Live update not sent");
		warnedAt = Date.now();
		unlogged = 0;
	};

	const key = (channel: string, id: string): string =>
		JSON.stringify([channel, id]);

	const deliver =
		(channel: string) =>
		(message: string): void => {
			const update = liveUpdateParse(message);
			if (update === undefined) {
				logger.warn({ channel }, "Dropped a malformed live update");
				return;
			}
			for (const listener of listeners.get(key(channel, update.id)) ?? []) {
				listener(update);
			}
		};

	const subscribe = (channel: string): Promise<void> => {
		let subscription = subscriptions.get(channel);
		if (subscription === undefined) {
			subscription = transport.subscribe(channel, deliver(channel));
			subscriptions.set(channel, subscription);
			// A failed subscribe is retried by the next stream.
			subscription.catch(() => subscriptions.delete(channel));
		}
		return subscription;
	};

	const close = async (): Promise<void> => {
		if (closed) return;
		closed = true;
		await Promise.all([...ends].map((end) => end()));
		await transport.close();
	};
	const liveHub: LiveHub = {
		close,
		[Symbol.asyncDispose]: close,
		send: async (channel, { id, type }) => {
			try {
				await transport.publish(channel, JSON.stringify({ id, type }));
			} catch (err) {
				sendFailed(channel, err);
			}
		},
	};

	liveHubStreamsByHub.set(liveHub, {
		isClosed: () => closed,
		listen: async ({ channel, id, listener, resync }) => {
			await subscribe(channel);
			const listenerKey = key(channel, id);
			let set = listeners.get(listenerKey);
			if (set === undefined) {
				set = new Set();
				listeners.set(listenerKey, set);
			}
			const own = set;
			own.add(listener);
			resyncs.add(resync);
			return () => {
				resyncs.delete(resync);
				own.delete(listener);
				if (own.size === 0 && listeners.get(listenerKey) === own) {
					listeners.delete(listenerKey);
				}
			};
		},
		track: (end) => {
			ends.add(end);
			return () => {
				ends.delete(end);
			};
		},
	});
	return liveHub;
};
