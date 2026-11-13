import type { Result } from "@n8io/baseline-result";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { type Queue, queueBossGet } from "./queue.ts";
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

// Where an issue is in the Event, as `items.0.name`; the Event itself is the empty path.
const issuePath = (issue: StandardSchemaV1.Issue): string =>
	(issue.path ?? [])
		.map((segment) =>
			String(typeof segment === "object" ? segment.key : segment),
		)
		.join(".");

// queueName is `<consumer domain>.<event entity>-<event verb>` (billing.order-placed); it is also the
// inbox `consumer` key. The schema is any Standard Schema (https://standardschema.dev): a Zod,
// Valibot or ArkType schema as it is.
export const queueConsumerCreate = <S extends StandardSchemaV1>({
	eventName,
	queueName,
	run,
	schema,
}: {
	eventName: string;
	queueName: string;
	run: (
		event: StandardSchemaV1.InferOutput<S>,
		inbox: Inbox,
	) => Promise<Result<unknown, { type: string }>>;
	schema: S;
}): Consumer => ({
	eventName,
	queueName,
	run: async (data, inbox) => {
		const result = await schema["~standard"].validate(data);
		if (result.issues !== undefined) {
			// Paths only, never a validator's message: it may repeat the Event's values, and this
			// error is logged and kept on the job. A path does include a record's or map's keys.
			const paths = [...new Set(result.issues.map(issuePath))]
				.filter((path) => path !== "")
				.join(", ");
			throw new Error(
				`Event failed validation for ${queueName}${paths === "" ? "" : ` at ${paths}`}`,
			);
		}
		return run(result.value, inbox);
	},
});

// pg-boss copies a published event only into queues already subscribed to it, so every instance
// that may publish subscribes at boot. Safe to repeat on any number of instances.
export const queueConsumersSubscribe = async (
	queue: Queue,
	consumers: Consumer[],
): Promise<void> => {
	const boss = queueBossGet(queue);
	for (const consumer of consumers) {
		await queueWithDeadLetterCreate({ boss, name: consumer.queueName });
		await boss.subscribe(consumer.eventName, consumer.queueName);
	}
};

// The inbox key that makes a repeated job a no-op. A retry keeps the job id, but a redrive from the
// dead-letter queue makes a new job; sourceRootId is the first job's id, kept through every dead
// letter and redrive, so the event keeps one id however often it comes back.
const consumerEventId = (job: {
	id: string;
	sourceRootId: string | null;
}): string => job.sourceRootId ?? job.id;

// Subscribes, then starts a worker per consumer (worker process only).
export const queueConsumersStart = async (
	queue: Queue,
	consumers: Consumer[],
): Promise<void> => {
	await queueConsumersSubscribe(queue, consumers);
	const boss = queueBossGet(queue);
	for (const consumer of consumers) {
		await boss.work(
			consumer.queueName,
			{ includeMetadata: true },
			async (jobs) => {
				for (const job of jobs) {
					await queueJobRun({
						queueName: consumer.queueName,
						job,
						work: () =>
							consumer.run(job.data, {
								consumer: consumer.queueName,
								eventId: consumerEventId(job),
							}),
					});
				}
			},
		);
	}
};
