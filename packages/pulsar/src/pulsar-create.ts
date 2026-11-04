import { logger } from "@n8io/baseline-logger";
import PulsarClient from "pulsar-client";

export type Pulsar = {
	// false once a producer or consumer has been disconnected for 60 s.
	isAlive(): boolean;
	// Closes consumers, waits up to 15 s for running Consumers, then flushes producers and closes
	// the client.
	stop(): Promise<void>;
};

// What the other modules of this package reach through a Pulsar.
export type PulsarState = {
	readonly client: PulsarClient.Client;
	readonly connections: { isConnected(): boolean }[];
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

// The client logs through its C++ library; only warnings and errors reach the app's logger.
const pulsarLog = (
	level: PulsarClient.LogLevel,
	file: string,
	line: number,
	message: string,
): void => {
	if (level === PulsarClient.LogLevel.ERROR) {
		logger.error({ pulsarSource: `${file}:${line}` }, message);
	} else if (level === PulsarClient.LogLevel.WARN) {
		logger.warn({ pulsarSource: `${file}:${line}` }, message);
	}
};

const pulsarStop = async (
	state: PulsarState,
	producers: Map<string, Promise<PulsarClient.Producer>>,
): Promise<void> => {
	state.stopping = true;
	// Unacknowledged Events go back to the subscription for another worker.
	await Promise.allSettled(state.consumers.map((consumer) => consumer.close()));
	await Promise.race([
		Promise.allSettled(state.running),
		new Promise((resolve) => setTimeout(resolve, pulsarStopGraceMs).unref()),
	]);
	await Promise.allSettled(
		[...producers.values()].map(async (opening) => {
			const producer = await opening;
			await producer.flush();
			await producer.close();
		}),
	);
	await state.client.close();
};

// Opens a client to `serviceUrl` (pulsar:// or pulsar+ssl://). `token` is a JWT for the broker's
// token authentication; without one the client connects unauthenticated. Each Event's topic is
// `persistent://<namespace>/<event name>`. retryDelayMs is the wait before a failed Event's second
// attempt; it doubles for each later one (10 s, 20 s, 40 s, 80 s, as in the queue package).
export const pulsarCreate = (options: {
	serviceUrl: string;
	token?: string;
	namespace?: string;
	retryDelayMs?: number;
}): Pulsar => {
	const namespace = options.namespace ?? "public/default";
	const client = new PulsarClient.Client({
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
	const state: PulsarState = {
		client,
		connections: [],
		consumers: [],
		producer: (topic) => {
			let opening = producers.get(topic);
			if (opening === undefined) {
				opening = client.createProducer({ topic });
				producers.set(topic, opening);
				opening.then(
					(producer) => state.connections.push(producer),
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
	const disconnectedSince = new Map<object, number>();
	const pulsar: Pulsar = {
		isAlive: () => {
			const now = Date.now();
			return state.connections.every((connection) => {
				if (connection.isConnected()) {
					disconnectedSince.delete(connection);
					return true;
				}
				const since = disconnectedSince.get(connection) ?? now;
				disconnectedSince.set(connection, since);
				return now - since < pulsarDisconnectedLimitMs;
			});
		},
		stop: () => pulsarStop(state, producers),
	};
	pulsarStates.set(pulsar, state);
	return pulsar;
};
