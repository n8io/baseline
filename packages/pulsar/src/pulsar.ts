import { logger } from "@n8io/baseline-logger";
import PulsarClient from "pulsar-client";

export type Pulsar = {
	// false once a producer or consumer has stayed disconnected for 60 s.
	isAlive(): boolean;
	// An intake: stops receiving and waits up to 15 s for running Consumers. Events they send
	// still go out until close().
	stop(): Promise<void>;
	// A resource, after every intake that may send: stops if needed, flushes producers and
	// closes the client.
	close(): Promise<void>;
	// Calls close(), so `await using` closes it when its block ends.
	[Symbol.asyncDispose](): Promise<void>;
};

// What the other modules of this package reach through a Pulsar.
export type PulsarState = {
	readonly client: PulsarClient.Client;
	readonly consumers: PulsarClient.Consumer[];
	readonly retryDelayMs: number;
	readonly running: Set<Promise<void>>;
	stopping: boolean;
	producer(topic: string): Promise<PulsarClient.Producer>;
	topic(name: string): string;
};

const pulsarDisconnectedLimitMs = 60_000;
const pulsarStopGraceMs = 15_000;

const pulsarStates = new WeakMap<Pulsar, PulsarState>();

export const pulsarState = (pulsar: Pulsar): PulsarState => {
	const state = pulsarStates.get(pulsar);
	if (state === undefined) {
		throw new TypeError("Expected a Pulsar from pulsarCreate");
	}
	return state;
};

const pulsarLogLevels = new Map<PulsarClient.LogLevel, "warn" | "error">([
	[PulsarClient.LogLevel.WARN, "warn"],
	[PulsarClient.LogLevel.ERROR, "error"],
]);

// The client logs through its C++ library; only warnings and errors reach the app's logger.
const pulsarLog = (
	level: PulsarClient.LogLevel,
	file: string,
	line: number,
	message: string,
): void => {
	const method = pulsarLogLevels.get(level);
	if (method) logger[method]({ pulsarSource: `${file}:${line}` }, message);
};

const pulsarStop = async (state: PulsarState): Promise<void> => {
	state.stopping = true;
	// Running Consumers finish and acknowledge first; what they leave goes back to the broker.
	await Promise.race([
		Promise.allSettled(state.running),
		new Promise((resolve) => setTimeout(resolve, pulsarStopGraceMs).unref()),
	]);
	await Promise.allSettled(state.consumers.map((consumer) => consumer.close()));
};

/**
 * The Pulsar client's own settings, passed through as they are. Outside this Package's contract:
 * nothing here is tested, and moving off Pulsar deletes it. `log` is refused, and
 * `authentication` is refused together with `token`.
 */
export type PulsarVendorOptions = Omit<PulsarClient.ClientConfigBase, "log">;

// Opens a client to `serviceUrl` (pulsar:// or pulsar+ssl://). `token` is a JWT for the broker's
// token authentication; without one the client connects unauthenticated. Each Event's topic is
// `persistent://<namespace>/<event name>`. retryDelayMs is the wait before a failed Event's second
// attempt; it doubles for each later one (10 s, 20 s, 40 s, 80 s, as in the queue package).
export const pulsarCreate = (options: {
	serviceUrl: string;
	token?: string | undefined;
	namespace?: string;
	retryDelayMs?: number;
	/** Settings only the Pulsar client has, such as TLS files or OAuth2 `authentication`. */
	vendor?: PulsarVendorOptions;
}): Pulsar => {
	const namespace = options.namespace ?? "public/default";
	const vendor = options.vendor ?? {};
	for (const key of ["log", "serviceUrl", "serviceUrlProvider"]) {
		if (key in vendor) {
			throw new TypeError(
				`vendor.${key} is not allowed: pulsarCreate sets it itself`,
			);
		}
	}
	if (options.token !== undefined && vendor.authentication !== undefined) {
		throw new TypeError(
			"Pass token or vendor.authentication to pulsarCreate, not both",
		);
	}
	const client = new PulsarClient.Client({
		...vendor,
		...(options.token === undefined
			? {}
			: {
					authentication: new PulsarClient.AuthenticationToken({
						token: options.token,
					}),
				}),
		log: pulsarLog,
		serviceUrl: options.serviceUrl,
	});
	const producers = new Map<string, Promise<PulsarClient.Producer>>();
	const opened: PulsarClient.Producer[] = [];
	let closing = false;
	const state: PulsarState = {
		client,
		consumers: [],
		producer: (topic) => {
			if (closing) {
				return Promise.reject(new Error("Pulsar is closed"));
			}
			let opening = producers.get(topic);
			if (opening === undefined) {
				opening = client.createProducer({ topic });
				producers.set(topic, opening);
				opening.then(
					(producer) => opened.push(producer),
					// A failed create is tried again on the next send.
					() => producers.delete(topic),
				);
			}
			return opening;
		},
		retryDelayMs: options.retryDelayMs ?? 10_000,
		running: new Set(),
		stopping: false,
		topic: (name) => `persistent://${namespace}/${name}`,
	};
	let downSince: number | undefined;
	let stopped: Promise<void> | undefined;
	const pulsar: Pulsar = {
		close: async () => {
			await pulsar.stop();
			closing = true;
			await Promise.allSettled(
				[...producers.values()].map(async (opening) => {
					const producer = await opening;
					await producer.flush();
					await producer.close();
				}),
			);
			await client.close();
		},
		isAlive: () => {
			const connections = [...state.consumers, ...opened];
			if (connections.every((connection) => connection.isConnected())) {
				downSince = undefined;
				return true;
			}
			downSince ??= Date.now();
			return Date.now() - downSince < pulsarDisconnectedLimitMs;
		},
		stop: () => {
			stopped ??= pulsarStop(state);
			return stopped;
		},
		[Symbol.asyncDispose]: () => pulsar.close(),
	};
	pulsarStates.set(pulsar, state);
	return pulsar;
};
