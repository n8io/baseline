// Composition root for an operator: lists and releases the Event keys a failed Event holds back.
// Run it in a pod as the migrate entry runs, `node src/blocked-keys.ts` (locally `pnpm blocked-keys`):
//   (no arguments)             lists every blocked key
//   retry <consumer> <key>     runs the failed Event again, before the Events waiting behind it
//   give-up <consumer> <key>   deletes the failed Event, so the key moves on (its dead-letter copy stays)
// <consumer> is the Consumer's queueName. It exits 1 when it released nothing.
// `pnpm piece-remove queue` deletes this file.
import { logger } from "@n8io/baseline-logger";
import { type Queue, queueCreate } from "@n8io/baseline-queue";
import { telemetryShutdown } from "@n8io/baseline-telemetry";
import { ENV } from "#env";
import { databaseOpen } from "./connections.ts";

const blockedKeyReleases = {
	"give-up": (queue: Queue, blocked: { consumer: string; key: string }) =>
		queue.blockedKeyGiveUp(blocked),
	retry: (queue: Queue, blocked: { consumer: string; key: string }) =>
		queue.blockedKeyRetry(blocked),
};

// The exit code: 0 when it listed or released, 1 when it released nothing or was called wrong.
const blockedKeysRun = async (
	queue: Queue,
	args: string[],
): Promise<number> => {
	const [command, consumer, key, ...rest] = args;
	if (command === undefined) {
		const blocked = await queue.blockedKeys();
		for (const entry of blocked) {
			logger.info(entry, "Event key is blocked");
		}
		logger.info({ count: blocked.length }, "Blocked Event keys listed");
		return 0;
	}
	if (
		!Object.hasOwn(blockedKeyReleases, command) ||
		consumer === undefined ||
		key === undefined ||
		rest.length > 0
	) {
		logger.error(
			{ args },
			"Usage: blocked-keys [retry <consumer> <key> | give-up <consumer> <key>]",
		);
		return 1;
	}
	const release =
		blockedKeyReleases[command as keyof typeof blockedKeyReleases];
	if (!(await release(queue, { consumer, key }))) {
		logger.error(
			{ consumer, key },
			"Nothing released: that Consumer has no blocked Event for that key",
		);
		return 1;
	}
	logger.info(
		{ consumer, key },
		command === "retry"
			? "Released: the failed Event runs again, before the Events behind it"
			: "Released: the failed Event was given up, and the key moves on",
	);
	return 0;
};

const database = databaseOpen({
	poolMax: 2,
	role: "publisher",
	url: ENV.DATABASE_URL,
});
try {
	if (database === "memory") {
		logger.error("memory database: there is no queue to look at");
		process.exitCode = 1;
	} else {
		await using pgPool = database;
		await using queue = await queueCreate({ pgPool, role: "publisher" });
		process.exitCode = await blockedKeysRun(queue, process.argv.slice(2));
	}
} finally {
	// Its spans and logs are lost when the process ends unflushed.
	await telemetryShutdown();
}
