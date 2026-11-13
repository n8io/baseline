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

// The subscription is the Consumer's queueName: Shared, so every worker instance takes a share of
// its Events. An Event that fails its fifth attempt goes to `<queueName>.dead`, which keeps a
// subscription of the same name so the dead letters stay until someone reads them.
const pulsarSubscribeConfig = (
	state: PulsarState,
	consumer: Consumer,
): PulsarClient.ConsumerConfig => ({
	deadLetterPolicy: {
		deadLetterTopic: state.topic(`${consumer.queueName}.dead`),
		initialSubscriptionName: consumer.queueName,
		maxRedeliverCount: queueRetryLimit,
	},
	// The backoff is timed here before the negative ack, so the client redelivers at once.
	nAckRedeliverTimeoutMs: 100,
	// A small prefetch, so one instance does not hold Events other instances could run.
	receiverQueueSize: 10,
	subscription: consumer.queueName,
	subscriptionType: "Shared",
	topic: state.topic(consumer.eventName),
});

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

const pulsarEventRun = (
	state: PulsarState,
	consumer: Consumer,
	subscribed: PulsarClient.Consumer,
	message: PulsarClient.Message,
): Promise<void> => {
	const properties: Record<string, string> = { ...message.getProperties() };
	const topic = message.getTopicName();
	const attempt = message.getRedeliveryCount();
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
				await queueJobRun(consumer.queueName, { retryCount: attempt }, () =>
					consumer.run(JSON.parse(message.getData().toString()), {
						consumer: consumer.queueName,
						eventId:
							properties[pulsarEventIdProperty] ??
							message.getMessageId().toString(),
					}),
				);
				await subscribed.acknowledge(message);
			} catch (error) {
				span.setAttribute(
					"error.type",
					error instanceof Error ? error.name : "_OTHER",
				);
				span.setStatus({ code: SpanStatusCode.ERROR });
				// 10 s, 20 s, 40 s, 80 s; after the last attempt, straight to the dead letter.
				const delayMs =
					attempt >= queueRetryLimit ? 0 : state.retryDelayMs * 2 ** attempt;
				// A no-op once stop() has closed the consumer: the broker redelivers it anyway.
				setTimeout(
					() => subscribed.negativeAcknowledge(message),
					delayMs,
				).unref();
			} finally {
				span.end();
			}
		},
	);
};

const pulsarConsumerLoop = async (
	state: PulsarState,
	consumer: Consumer,
	subscribed: PulsarClient.Consumer,
): Promise<void> => {
	while (!state.stopping) {
		let message: PulsarClient.Message;
		try {
			message = await subscribed.receive();
		} catch (error) {
			if (state.stopping) return;
			logger.error(
				{ err: error, queue: consumer.queueName },
				"Pulsar receive failed",
			);
			await new Promise((resolve) => setTimeout(resolve, 1_000));
			continue;
		}
		// Left unacknowledged: the broker redelivers it once stop() closes the consumer.
		if (state.stopping) return;
		// One Event at a time per Consumer per instance, like the queue package's workers.
		const running = pulsarEventRun(state, consumer, subscribed, message);
		state.running.add(running);
		await running;
		state.running.delete(running);
	}
};

// Subscribes and starts receiving for each Consumer (worker process only).
export const pulsarConsumersStart = async (
	pulsar: Pulsar,
	consumers: Consumer[],
): Promise<void> => {
	const state = pulsarState(pulsar);
	for (const consumer of consumers) {
		const subscribed = await state.client.subscribe(
			pulsarSubscribeConfig(state, consumer),
		);
		state.consumers.push(subscribed);
		void pulsarConsumerLoop(state, consumer, subscribed);
	}
};
