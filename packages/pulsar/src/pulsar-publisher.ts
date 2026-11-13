import { randomUUID } from "node:crypto";
import { logger } from "@n8io/baseline-logger";
import type { EventsPublisher } from "@n8io/baseline-queue";
import {
	type Context,
	type Counter,
	context,
	defaultTextMapSetter,
	metrics,
	SpanKind,
	SpanStatusCode,
	type Tracer,
	trace,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import type { PulsarState } from "./pulsar.ts";

// Set at publish and kept through every redelivery and the dead letter; it is the inbox eventId.
export const pulsarEventIdProperty = "event-id";

// Trace context only: baggage never reaches the broker.
export const pulsarPropagator: W3CTraceContextPropagator =
	new W3CTraceContextPropagator();

export const pulsarTracer = (): Tracer =>
	trace.getTracer("@n8io/baseline-pulsar");

let eventsLost: Counter | undefined;

// Taken on first use, after the telemetry preload has registered the meter provider.
const pulsarEventsLostCounter = (): Counter => {
	eventsLost ??= metrics
		.getMeter("@n8io/baseline-pulsar")
		.createCounter("baseline.pulsar.events_lost", {
			description: "Events not sent after their transaction committed",
			unit: "{event}",
		});
	return eventsLost;
};

type PulsarEventBuffered = {
	readonly context: Context;
	readonly data: unknown;
	readonly eventId: string;
	readonly key: string;
	readonly name: string;
};

const pulsarEventSend = (
	state: PulsarState,
	event: PulsarEventBuffered,
): Promise<void> => {
	const topic = state.topic(event.name);
	// The publishing use case's span is the parent, though the send runs after its commit.
	return pulsarTracer().startActiveSpan(
		`send ${topic}`,
		{
			attributes: {
				"messaging.destination.name": topic,
				"messaging.operation.name": "send",
				"messaging.operation.type": "send",
				"messaging.system": "pulsar",
			},
			kind: SpanKind.PRODUCER,
		},
		event.context,
		async (span) => {
			const properties = { [pulsarEventIdProperty]: event.eventId };
			pulsarPropagator.inject(
				context.active(),
				properties,
				defaultTextMapSetter,
			);
			try {
				const producer = await state.producer(topic);
				const messageId = await producer.send({
					data: Buffer.from(JSON.stringify(event.data)),
					// The Event's key, so the broker can keep one key's Events together and in order.
					partitionKey: event.key,
					properties,
				});
				span.setAttribute("messaging.message.id", messageId.toString());
			} catch (error) {
				span.setAttribute(
					"error.type",
					error instanceof Error ? error.name : "_OTHER",
				);
				span.setStatus({ code: SpanStatusCode.ERROR });
				logger.error(
					{ err: error, eventId: event.eventId, topic },
					"Event not sent after commit; it is lost",
				);
				pulsarEventsLostCounter().add(1, {
					"messaging.destination.name": topic,
				});
			} finally {
				span.end();
			}
		},
	);
};

// One per transaction: publish only buffers, so nothing reaches the broker before the commit.
// committed() sends the buffer; a failed send is logged, not thrown, because the change is already
// committed.
export const pulsarPublisherCreate = <M extends Record<string, unknown>>(
	state: PulsarState,
): EventsPublisher<M> => {
	let buffered: PulsarEventBuffered[] = [];
	return {
		committed: async () => {
			const sending = buffered;
			buffered = [];
			// Issued in publish order; one producer per topic keeps that order on the broker.
			await Promise.all(sending.map((event) => pulsarEventSend(state, event)));
		},
		publish: async ({ data, key, name }) => {
			buffered.push({
				context: context.active(),
				data,
				eventId: randomUUID(),
				key,
				name,
			});
		},
	};
};
