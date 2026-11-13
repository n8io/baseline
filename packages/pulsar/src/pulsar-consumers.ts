import { setTimeout } from "node:timers/promises";
import { logger } from "@n8io/baseline-logger";
import {
	type Consumer,
	queueJobRun,
	queueRetryLimit,
} from "@n8io/baseline-queue";
import {
	defaultTextMapGetter,
	ROOT_CONTEXT,
	SpanKind,
	SpanStatusCode,
} from "@opentelemetry/api";
import type PulsarClient from "pulsar-client";
import { type Pulsar, type PulsarState, pulsarState } from "./pulsar.ts";
import {
	pulsarEventIdProperty,
	pulsarPropagator,
	pulsarTracer,
} from "./pulsar-publisher.ts";

// How many Events one Consumer holds on one instance. Each is running, waiting for its next
// attempt, or waiting behind an earlier Event of its key.
const pulsarHeldLimit = 4;

// How long a receive waits for an Event before the loop comes round again.
const pulsarReceiveWaitMs = 1_000;

// The subscription is the Consumer's queueName. The broker gives all Events of one Event key to one
// worker instance at a time, in the order they were sent, and spreads the keys over the instances.
const pulsarSubscribeConfig = (
	state: PulsarState,
	consumer: Consumer,
): PulsarClient.ConsumerConfig => ({
	// A small prefetch: a key moves to a new instance only once the old one has let go of it.
	receiverQueueSize: 10,
	subscription: consumer.queueName,
	subscriptionType: "KeyShared",
	topic: state.topic(consumer.eventName),
});

// Resolves after `ms`, or as soon as stop() begins.
const pulsarWait = async (state: PulsarState, ms: number): Promise<void> => {
	await setTimeout(ms, undefined, {
		ref: false,
		signal: state.stop.signal,
	}).catch(() => undefined);
};

// A subscription keeps only Events sent after it exists, so every instance that may publish
// creates the subscriptions at boot. Safe to repeat on any number of instances.
export const pulsarConsumersSubscribe = async (
	pulsar: Pulsar,
	consumers: Consumer[],
): Promise<void> => {
	const state = pulsarState(pulsar);
	for (const consumer of consumers) {
		// No prefetch: this consumer never receives, so it must not hold Events from the workers.
		const subscribed = await state.client.subscribe({
			...pulsarSubscribeConfig(state, consumer),
			receiverQueueSize: 0,
		});
		await subscribed.close();
	}
};

type PulsarEventHeld = {
	consumer: Consumer;
	message: PulsarClient.Message;
	state: PulsarState;
	subscribed: PulsarClient.Consumer;
};

// One attempt in its own process span. true when the Consumer finished, false when it threw.
const pulsarEventAttempt = (
	{ consumer, message }: PulsarEventHeld,
	attempt: number,
): Promise<boolean> => {
	const properties: Record<string, string> = { ...message.getProperties() };
	const topic = message.getTopicName();
	return pulsarTracer().startActiveSpan(
		`process ${topic}`,
		{
			attributes: {
				"messaging.destination.name": topic,
				"messaging.destination.subscription.name": consumer.queueName,
				"messaging.message.id": message.getMessageId().toString(),
				"messaging.operation.name": "process",
				"messaging.operation.type": "process",
				"messaging.system": "pulsar",
			},
			kind: SpanKind.CONSUMER,
		},
		pulsarPropagator.extract(ROOT_CONTEXT, properties, defaultTextMapGetter),
		async (span) => {
			try {
				await queueJobRun({
					queueName: consumer.queueName,
					job: { retryCount: attempt },
					work: () =>
						consumer.run(JSON.parse(message.getData().toString()), {
							consumer: consumer.queueName,
							eventId:
								properties[pulsarEventIdProperty] ??
								message.getMessageId().toString(),
						}),
				});
				return true;
			} catch (error) {
				span.setAttribute(
					"error.type",
					error instanceof Error ? error.name : "_OTHER",
				);
				span.setStatus({ code: SpanStatusCode.ERROR });
				return false;
			} finally {
				span.end();
			}
		},
	);
};

// Copies the Event to `<queueName>.dead` as it was sent, then acknowledges it so its key moves on.
// Tried until it works: an Event is never dropped because the broker was away.
const pulsarEventDeadLetter = async ({
	consumer,
	message,
	state,
	subscribed,
}: PulsarEventHeld): Promise<void> => {
	const topic = state.topic(`${consumer.queueName}.dead`);
	let sent = false;
	while (!state.stop.signal.aborted) {
		try {
			if (!sent) {
				// A topic keeps an Event only for a subscription that exists, so make sure of it first.
				const kept = await state.client.subscribe({
					receiverQueueSize: 0,
					subscription: consumer.queueName,
					subscriptionType: "Shared",
					topic,
				});
				await kept.close();
				const producer = await state.producer(topic);
				await producer.send({
					data: message.getData(),
					partitionKey: message.getPartitionKey(),
					properties: message.getProperties(),
				});
				sent = true;
			}
			await subscribed.acknowledge(message);
			return;
		} catch (error) {
			logger.error(
				{ err: error, queue: consumer.queueName },
				"Dead letter not sent; its key waits until it is",
			);
			await pulsarWait(state, state.retryDelayMs);
		}
	}
};

// Runs one Event to its end while holding it, so no later Event of its key can pass it: up to five
// attempts, waiting 10 s, 20 s, 40 s and 80 s between them, then the dead letter. The broker's own
// redelivery is not used, because it hands a failed Event back behind the later ones of its key.
// Never rejects. An Event left unacknowledged at stop() goes to another instance, which starts over.
const pulsarEventRun = async (held: PulsarEventHeld): Promise<void> => {
	const { consumer, message, state, subscribed } = held;
	try {
		for (let attempt = 0; !state.stop.signal.aborted; attempt += 1) {
			if (await pulsarEventAttempt(held, attempt)) {
				await subscribed.acknowledge(message);
				return;
			}
			if (attempt >= queueRetryLimit) {
				await pulsarEventDeadLetter(held);
				return;
			}
			await pulsarWait(state, state.retryDelayMs * 2 ** attempt);
		}
	} catch (error) {
		// The Event ran; the broker sends it again and the inbox skips it.
		logger.warn(
			{ err: error, queue: consumer.queueName },
			"Event not acknowledged",
		);
	}
};

const pulsarConsumerLoop = async ({
	consumer,
	state,
	subscribed,
}: {
	consumer: Consumer;
	state: PulsarState;
	subscribed: PulsarClient.Consumer;
}): Promise<void> => {
	const loop = { beatAt: performance.now() };
	state.loops.push(loop);
	// Per Event key, the Events held now: each runs after the one before it has ended.
	const lanes = new Map<string, Promise<void>>();
	// After a reconnect the broker sends again what is still held here; those copies are dropped.
	const heldIds = new Set<string>();
	let heldFewer = (): void => undefined;
	while (!state.stop.signal.aborted) {
		loop.beatAt = performance.now();
		if (heldIds.size >= pulsarHeldLimit) {
			await Promise.race([
				new Promise<void>((resolve) => {
					heldFewer = resolve;
				}),
				pulsarWait(state, pulsarReceiveWaitMs),
			]);
			continue;
		}
		let message: PulsarClient.Message | undefined;
		try {
			// Empty after the wait, also while the broker is away: the client reconnects by itself.
			[message] = await subscribed.batchReceive();
		} catch (error) {
			if (state.stop.signal.aborted) return;
			logger.error(
				{ err: error, queue: consumer.queueName },
				"Pulsar receive failed",
			);
			await pulsarWait(state, pulsarReceiveWaitMs);
			continue;
		}
		// Left unacknowledged: the broker redelivers it once stop() closes the consumer.
		if (message === undefined || state.stop.signal.aborted) continue;
		const id = message.getMessageId().toString();
		if (heldIds.has(id)) continue;
		heldIds.add(id);
		const key = message.getPartitionKey();
		const event = { consumer, message, state, subscribed };
		const lane = (lanes.get(key) ?? Promise.resolve())
			.then(() => pulsarEventRun(event))
			.then(() => {
				heldIds.delete(id);
				heldFewer();
				state.running.delete(lane);
				if (lanes.get(key) === lane) lanes.delete(key);
			});
		lanes.set(key, lane);
		state.running.add(lane);
	}
};

// Subscribes and starts receiving for each Consumer (worker process only).
export const pulsarConsumersStart = async (
	pulsar: Pulsar,
	consumers: Consumer[],
): Promise<void> => {
	const state = pulsarState(pulsar);
	for (const consumer of consumers) {
		const subscribed = await state.client.subscribe({
			...pulsarSubscribeConfig(state, consumer),
			// At most one Event per receive, or none once the wait is over.
			batchReceivePolicy: { maxNumMessages: 1, timeoutMs: pulsarReceiveWaitMs },
		});
		state.consumers.push(subscribed);
		void pulsarConsumerLoop({ state, consumer, subscribed });
	}
};
