import { logger } from "@n8io/baseline-logger";
import type { Result } from "@n8io/baseline-result";
import { type Counter, metrics, trace } from "@opentelemetry/api";
import { queueRetryLimit } from "./queue-retry.ts";

let deadLetters: Counter | undefined;

// Taken on first use, after the telemetry preload has registered the meter provider.
const deadLettersCounter = (): Counter => {
	deadLetters ??= metrics
		.getMeter("@n8io/baseline-queue")
		.createCounter("baseline.queue.dead_letters", {
			description: "Jobs moved to a dead-letter queue after their last attempt",
			unit: "{job}",
		});
	return deadLetters;
};

// Runs one job's work inside pg-boss's process span. ok and err both complete the job; err is an
// expected business outcome, so it only marks the span. A throw fails the job, which pg-boss
// retries and, after the last attempt, moves to the dead-letter queue. The counter sees only those
// throws: jobs pg-boss fails itself (expired, or still active after the 15 s stop grace) skip it,
// and pg-boss's pgboss.queue.jobs gauge shows every `<name>.dead` queue's size. A Consumer's job
// carries its `key`: its last failure also leaves the job where it is, holding the key back.
export const queueJobRun = async ({
	job,
	queueName,
	work,
}: {
	job: { key?: string | null; retryCount: number };
	queueName: string;
	work: () => Promise<Result<unknown, { type: string }>>;
}): Promise<void> => {
	let result: Result<unknown, { type: string }>;
	try {
		result = await work();
	} catch (error) {
		const last = job.retryCount >= queueRetryLimit;
		const blocked = last && job.key != null;
		logger.error(
			{
				err: error,
				queue: queueName,
				attempt: job.retryCount + 1,
				...(blocked && { key: job.key }),
			},
			blocked
				? "Job failed; copied to dead letter, and its key is blocked until released"
				: last
					? "Job failed; moved to dead letter"
					: "Job failed; will retry",
		);
		if (last) {
			deadLettersCounter().add(1, { "messaging.destination.name": queueName });
		}
		throw error;
	}
	if (!result.ok) {
		trace.getActiveSpan()?.setAttribute("error.type", result.error.type);
	}
};
