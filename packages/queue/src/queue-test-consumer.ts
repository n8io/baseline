import type { Result } from "@n8io/baseline-result";
import type { Consumer } from "./queue-consumer.ts";

/** What `queueTestConsumerRun` takes. */
export type QueueTestConsumerRunOptions = {
	/** The Consumer to run. */
	consumer: Consumer;
	/** The Event's data, as it would be published. */
	data: unknown;
	/** The Event's id in the Inbox. Default a new one. */
	eventId?: string | null;
};

/**
 * Runs one Event through a Consumer the way the Worker does: the data is validated by the
 * Consumer's schema, and the Inbox names the Consumer and the Event id. `eventId` defaults to a
 * new id; pass one to run the same Event twice.
 */
export const queueTestConsumerRun = ({
	consumer,
	data,
	eventId,
}: QueueTestConsumerRunOptions): Promise<Result<unknown, { type: string }>> =>
	consumer.run(data, {
		consumer: consumer.queueName,
		eventId: eventId ?? crypto.randomUUID(),
	});
