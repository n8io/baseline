import type { PgBoss } from "pg-boss";

// Five attempts, waiting about 10 s, then 20 s, 40 s and 80 s between them.
export const queueRetryLimit = 4;

// Creates a queue (and its dead-letter queue `<name>.dead`) with the shared retry settings. Safe to
// repeat: pg-boss creates a queue only when it is missing.
export const queueWithDeadLetterCreate = async ({
	boss,
	name,
	policy,
}: {
	boss: PgBoss;
	name: string;
	policy?: "standard" | "exclusive" | null;
}): Promise<void> => {
	const deadLetter = `${name}.dead`;
	await boss.createQueue(deadLetter);
	await boss.createQueue(name, {
		deadLetter,
		policy: policy ?? "standard",
		retryBackoff: true,
		retryDelay: 10,
		retryLimit: queueRetryLimit,
	});
};
