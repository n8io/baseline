// The queue for a composition root, in the same Postgres as the Domains: "memory" with a memory
// database. `pnpm piece-remove queue` deletes this file.
import { type Queue, queueCreate } from "@n8io/baseline-queue";
import type { ShutdownStep } from "@n8io/baseline-shutdown";
import type pg from "pg";

// `steps` stops the queue at shutdown, before what is already in it.
export const queueOpen = async (
	database: pg.Pool | "memory",
	role: "publisher" | "worker",
	steps: ShutdownStep[],
): Promise<Queue | "memory"> => {
	if (database === "memory") return "memory";
	const queue = await queueCreate({ pgPool: database, role });
	steps.unshift({ close: () => queue.stop(), name: "queue" });
	return queue;
};
