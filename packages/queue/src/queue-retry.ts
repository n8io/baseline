import type { PgBoss } from "pg-boss";

// Five attempts, waiting 10 s, then 20 s, 40 s and 80 s between them, each up to twice as long. Kept small: while a
// Consumer's job waits for its retry, the later Events of its key wait behind it.
export const queueRetryLimit = 4;

// Creates a queue with the shared retry settings, and its dead-letter queue (`<name>.dead` unless
// `deadLetter` names one). A worker refreshes a running job's heartbeat; when the worker dies the
// heartbeat stops, and the job is retried within about a minute instead of after `expireInSeconds`
// (pg-boss's 15 minutes unless given). Safe to repeat: pg-boss creates a queue only when it is
// missing, and the update gives a queue from an earlier release today's settings.
export const queueWithDeadLetterCreate = async ({
	boss,
	deadLetter,
	expireInSeconds,
	name,
	policy,
}: {
	boss: PgBoss;
	deadLetter?: string | null;
	expireInSeconds?: number | null;
	name: string;
	policy?: "standard" | "exclusive" | "key_strict_fifo" | null;
}): Promise<void> => {
	const settings = {
		deadLetter: deadLetter ?? `${name}.dead`,
		...(expireInSeconds != null && { expireInSeconds }),
		heartbeatSeconds: 30,
		retryBackoff: true,
		retryDelay: 10,
		retryLimit: queueRetryLimit,
	};
	await boss.createQueue(settings.deadLetter);
	await boss.createQueue(name, { ...settings, policy: policy ?? "standard" });
	await boss.updateQueue(name, settings);
};
