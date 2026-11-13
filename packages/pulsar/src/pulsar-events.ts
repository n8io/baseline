import type { Events } from "@n8io/baseline-queue";
import { type Pulsar, pulsarState } from "./pulsar.ts";
import {
	pulsarConsumersStart,
	pulsarConsumersSubscribe,
} from "./pulsar-consumers.ts";
import { pulsarPublisherCreate } from "./pulsar-publisher.ts";

// Events on Pulsar, behind the same Events handle as the queue's. The broker is outside the
// transaction, so a publisher only buffers and sends once the transaction has committed.
export const pulsarEventsCreate = (pulsar: Pulsar): Events => {
	const state = pulsarState(pulsar);
	return {
		consumersStart: (consumers) => pulsarConsumersStart(pulsar, consumers),
		consumersSubscribe: (consumers) =>
			pulsarConsumersSubscribe(pulsar, consumers),
		isAlive: () => pulsar.isAlive(),
		publisherCreate: () => pulsarPublisherCreate(state),
	};
};
