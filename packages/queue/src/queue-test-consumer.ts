import type { Result } from "@n8io/baseline-result";
import type { Consumer } from "./queue-consumer.ts";

// Runs one Event through a Consumer the way the worker does: the data is validated by the
// Consumer's schema, and the Inbox names the Consumer and the Event id. `eventId` defaults to a
// new id; pass one to run the same Event twice.
export const queueTestConsumerRun = ({
	consumer,
	data,
	eventId,
}: {
	consumer: Consumer;
	data: unknown;
	eventId?: string | null;
}): Promise<Result<unknown, { type: string }>> =>
	consumer.run(data, {
		consumer: consumer.queueName,
		eventId: eventId ?? crypto.randomUUID(),
	});
