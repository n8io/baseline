// Composition root for an operator: lists and releases the Event keys a failed Event holds back.
// Run it in a pod as the migrate entry runs, `node src/blocked-keys.ts` (locally `pnpm blocked-keys`):
//   (no arguments)             lists every blocked key
//   retry <consumer> <key>     runs the failed Event again, before the Events waiting behind it
//   give-up <consumer> <key>   deletes the failed Event, so the key moves on (its dead-letter copy stays)
// <consumer> is the Event handler's queueName. It exits 1 when it released nothing.
// `pnpm piece-remove queue` deletes this file.
import type { Queue } from "@n8io/baseline-queue";
import type { ShutdownStep } from "@n8io/baseline-shutdown";
import { telemetryShutdown } from "@n8io/baseline-telemetry";
import { ENV } from "#env";
import { connectionsClose, databaseOpen } from "./connections.ts";
import { queueOpen } from "./queue-open.ts";

const blockedKeyReleases = {
	"give-up": (queue: Queue, blocked: { consumer: string; key: string }) =>
		queue.blockedKeyGiveUp(blocked),
	retry: (queue: Queue, blocked: { consumer: string; key: string }) =>
		queue.blockedKeyRetry(blocked),
};

// The exit code: 0 when it listed or released, 1 when it released nothing or was called wrong. It
// prints for the operator on stdout and stderr, not through the logger, so LOG_LEVEL never hides it.
const blockedKeysRun = async (
	queue: Queue,
	args: string[],
): Promise<number> => {
	const [command, consumer, key, ...rest] = args;
	if (command === undefined) {
		const blocked = await queue.blockedKeys();
		for (const entry of blocked) {
			console.log(
				`${entry.consumer} ${entry.key} blocked since ${entry.since.toISOString()}, deleted at ${entry.deleteAt.toISOString()} unless released`,
			);
		}
		console.log(`${blocked.length} blocked Event key(s)`);
		return 0;
	}
	if (
		!Object.hasOwn(blockedKeyReleases, command) ||
		consumer === undefined ||
		key === undefined ||
		rest.length > 0
	) {
		console.error(
			"Usage: blocked-keys [retry <consumer> <key> | give-up <consumer> <key>]",
		);
		return 1;
	}
	const release =
		blockedKeyReleases[command as keyof typeof blockedKeyReleases];
	if (!(await release(queue, { consumer, key }))) {
		console.error(
			`Nothing released: ${consumer} has no blocked Event for ${key}`,
		);
		return 1;
	}
	console.log(
		command === "retry"
			? `Released ${consumer} ${key}: the failed Event runs again, before the Events behind it`
			: `Released ${consumer} ${key}: the failed Event was given up, and the key moves on`,
	);
	return 0;
};

const database = databaseOpen({
	poolMax: 2,
	role: "publisher",
	url: ENV.DATABASE_URL,
});
// What queueOpen adds to close, then the pool, in that order.
const resources: ShutdownStep[] = [];
if (database !== "memory") {
	resources.push({ close: () => database.end(), name: "database" });
}
try {
	const { queue } = await queueOpen({
		database,
		intakes: [],
		resources,
		role: "publisher",
	});
	if (queue === "memory") {
		console.error("DATABASE_URL is memory://: there is no queue to look at");
		process.exitCode = 1;
	} else {
		process.exitCode = await blockedKeysRun(queue, process.argv.slice(2));
	}
} finally {
	await connectionsClose({ intakes: [], resources });
	// Its spans and logs are lost when the process ends unflushed.
	await telemetryShutdown();
}
