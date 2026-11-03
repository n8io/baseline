import type { Result } from "@n8io/baseline-result";
import type { z } from "zod";
import { type Queue, queueBoss } from "./queue-create.ts";
import type { Inbox } from "./queue-inbox.ts";
import { queueJobRun } from "./queue-job-run.ts";
import { queueWithDeadLetterCreate } from "./queue-retry.ts";

export type Consumer = {
	readonly queueName: string;
	readonly eventName: string;
	// Parses and runs one job's data; a parse failure throws, which fails the job.
	readonly run: (
		data: unknown,
		inbox: Inbox,
	) => Promise<Result<unknown, { type: string }>>;
};

// queueName is `<consumer domain>.<event entity>-<event verb>` (billing.order-placed); it is also the
// inbox `consumer` key.
export const consumerCreate = <S extends z.ZodType>(
	queueName: string,
	eventName: string,
	schema: S,
	run: (
		event: z.infer<S>,
		inbox: Inbox,
	) => Promise<Result<unknown, { type: string }>>,
): Consumer => ({
	eventName,
	queueName,
	run: async (data, inbox) => {
		const parsed = schema.safeParse(data);
		if (!parsed.success) {
			// The issues name paths and codes only: Zod 4 leaves input values out by default.
			throw new Error(`Event failed validation for ${queueName}`, {
				cause: parsed.error,
			});
		}
		return run(parsed.data, inbox);
	},
});

// pg-boss copies a published event only into queues already subscribed to it, so every instance
// that may publish subscribes at boot. Safe to repeat on any number of instances.
export const consumersSubscribe = async (
	queue: Queue,
	consumers: Consumer[],
): Promise<void> => {
	const boss = queueBoss(queue);
	for (const consumer of consumers) {
		await queueWithDeadLetterCreate(boss, consumer.queueName);
		await boss.subscribe(consumer.eventName, consumer.queueName);
	}
};

// The pg-boss job id, the inbox key that makes a repeated job a no-op.
const consumerEventId = (job: { id: string }): string => job.id;

// Subscribes, then starts a worker per consumer (worker process only).
export const consumersStart = async (
	queue: Queue,
	consumers: Consumer[],
): Promise<void> => {
	await consumersSubscribe(queue, consumers);
	const boss = queueBoss(queue);
	for (const consumer of consumers) {
		await boss.work(consumer.queueName, async (jobs) => {
			for (const job of jobs) {
				await queueJobRun(consumer.queueName, job, () =>
					consumer.run(job.data, {
						consumer: consumer.queueName,
						eventId: consumerEventId(job),
					}),
				);
			}
		});
	}
};
