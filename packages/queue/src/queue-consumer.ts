import type { Result } from "@n8io/baseline-result";
import {
	type Context,
	context,
	defaultTextMapGetter,
	ROOT_CONTEXT,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { JobResult, PgBoss } from "pg-boss";
import { type Queue, queueBossGet } from "./queue.ts";
import type { Inbox } from "./queue-inbox.ts";
import { queueJobRun } from "./queue-job-run.ts";
import { queueOrderedName } from "./queue-ordered.ts";
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

// A fetch whose jobs are not all done after this long has its unfinished jobs failed and retried,
// so a hung Consumer holds its key, and the jobs fetched with it, for five minutes at most.
const queueConsumerExpireSeconds = 300;

// Jobs taken per fetch (each of another key), and how many of them run at once.
const queueConsumerBatchSize = 10;
const queueConsumerConcurrency = 4;

// A publish copies an Event only into queues already subscribed to it, so every instance that may
// publish subscribes at boot. Safe to repeat on any number of instances.
export const queueConsumersSubscribe = async (
	queue: Queue,
	consumers: Consumer[],
): Promise<void> => {
	const boss = queueBossGet(queue);
	for (const consumer of consumers) {
		const name = queueOrderedName(consumer.queueName);
		await queueWithDeadLetterCreate({
			boss,
			deadLetter: `${consumer.queueName}.dead`,
			expireInSeconds: queueConsumerExpireSeconds,
			name,
			// One key's jobs strictly one after another, on every worker together; a failed job holds its
			// key back while it waits for a retry, and for good once it has none left.
			policy: "key_strict_fifo",
		});
		await boss.subscribe(queueOrderedName(consumer.eventName), name);
	}
};

// The inbox key that makes a repeated job a no-op. A retry keeps the job id, but a redrive from the
// dead-letter queue makes a new job; sourceRootId is the first job's id, kept through every dead
// letter and redrive, so the event keeps one id however often it comes back.
const consumerEventId = (job: {
	id: string;
	sourceRootId: string | null;
}): string => job.sourceRootId ?? job.id;

const propagator = new W3CTraceContextPropagator();

// pg-boss runs a fetch of one job in the publishing request's trace, but a fetch of several in a
// trace of its own. This reads what each job's publish stored, so every Consumer still runs in the
// trace of its Event.
const consumerTraceContexts = async (
	boss: PgBoss,
	jobs: { id: string; name: string }[],
): Promise<Map<string, Context>> => {
	const [first] = jobs;
	if (jobs.length < 2 || first === undefined) {
		return new Map();
	}
	// A failed read costs the jobs their trace, never their run.
	const { rows } = await boss
		.getDb()
		.executeSql(
			"SELECT id, trace_context FROM queue.job WHERE name = $1 AND id = ANY($2::uuid[])",
			[first.name, jobs.map((job) => job.id)],
		)
		.catch(() => ({ rows: [] }));
	return new Map(
		(rows as { id: string; trace_context: unknown }[]).map((row) => [
			row.id,
			propagator.extract(
				ROOT_CONTEXT,
				typeof row.trace_context === "string"
					? JSON.parse(row.trace_context)
					: (row.trace_context ?? {}),
				defaultTextMapGetter,
			),
		]),
	);
};

// Works one queue for a Consumer. A fetch that brought jobs is followed by the next at once, so a
// backlog (one busy key included, which gives one job per fetch) drains without waiting for a
// poll; an empty fetch goes back to polling. Each job is settled the moment it ends, so its key
// moves on while slower jobs of the same fetch still run, and one failed job fails alone. The
// results returned at the end settle only what that could not (pg-boss skips a settled job).
const consumerWork = async ({
	boss,
	consumer,
	name,
	options,
}: {
	boss: PgBoss;
	consumer: Consumer;
	name: string;
	options: { batchSize: number; pollingIntervalSeconds: number };
}): Promise<void> => {
	const workerId = await boss.work(
		name,
		{ ...options, includeMetadata: true, perJobResults: true },
		async (jobs) => {
			boss.notifyWorker(workerId);
			const traceContexts = await consumerTraceContexts(boss, jobs);
			const results: JobResult[] = [];
			const waiting = [...jobs];
			const lane = async (): Promise<void> => {
				for (let job = waiting.shift(); job; job = waiting.shift()) {
					const { id } = job;
					// pg-boss gave the job up (the fetch ran out of time, or the worker is stopping) and
					// has failed it for a retry: do not start it here as well.
					if (job.signal.aborted) {
						continue;
					}
					const run = (): Promise<void> =>
						queueJobRun({
							job: { key: job.singletonKey, retryCount: job.retryCount },
							queueName: consumer.queueName,
							work: () =>
								consumer.run(job.data, {
									consumer: consumer.queueName,
									eventId: consumerEventId(job),
								}),
						});
					const traceContext = traceContexts.get(id);
					try {
						await (traceContext ? context.with(traceContext, run) : run());
						results.push({ id, status: "completed" });
						await boss.complete(name, id).catch(() => undefined);
					} catch (error) {
						results.push({ id, output: error, status: "failed" });
						await boss.fail(name, id, error as Error).catch(() => undefined);
					}
				}
			};
			await Promise.all(
				Array.from({ length: queueConsumerConcurrency }, () => lane()),
			);
			return results;
		},
	);
};

// Subscribes, then starts a worker per consumer (worker process only).
export const queueConsumersStart = async (
	queue: Queue,
	consumers: Consumer[],
): Promise<void> => {
	await queueConsumersSubscribe(queue, consumers);
	const boss = queueBossGet(queue);
	for (const consumer of consumers) {
		await consumerWork({
			boss,
			consumer,
			name: queueOrderedName(consumer.queueName),
			options: { batchSize: queueConsumerBatchSize, pollingIntervalSeconds: 2 },
		});
		// A Project that ran a release before 8 still has the unordered queue `<queueName>`. Processes
		// of that release publish to it until the rollout ends, so it is drained here, one job at a
		// time as before, until queueMigrate removes it.
		if (await boss.getQueue(consumer.queueName)) {
			await consumerWork({
				boss,
				consumer,
				name: consumer.queueName,
				options: { batchSize: 1, pollingIntervalSeconds: 30 },
			});
		}
	}
};
